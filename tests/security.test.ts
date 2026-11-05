import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createIpResolver, normalizeIp } from "@/lib/security/client-ip";
import { csrfTokenValid, isSameOrigin } from "@/lib/security/csrf";
import { hashPassword, verifyPassword } from "@/lib/security/password";
import { RateLimiter } from "@/lib/security/rate-limit";
import { createSecurityLogger, formatTimestamp } from "@/lib/security/security-log";
import { createSession, refreshSession, sessionCookie, verifySession } from "@/lib/security/session";
import { generateToken, hashToken, isWellFormedToken } from "@/lib/security/tokens";

describe("Client-IP", () => {
  const resolve = createIpResolver(["172.18.0.0/16"]);
  it("übernimmt X-Forwarded-For nur von vertrauenswürdigem Peer", () => {
    expect(resolve("172.18.0.5", "203.0.113.5")).toBe("203.0.113.5");
  });
  it("gefälschter Header von außen ändert die IP nicht", () => {
    expect(resolve("198.51.100.7", "203.0.113.5")).toBe("198.51.100.7");
    expect(resolve("198.51.100.7", "172.18.0.9, 1.2.3.4")).toBe("198.51.100.7");
  });
  it("nimmt den ersten nicht vertrauenswürdigen Eintrag von rechts (Client kann links fälschen)", () => {
    expect(resolve("172.18.0.5", "6.6.6.6, 203.0.113.5")).toBe("203.0.113.5");
    expect(resolve("172.18.0.5", "203.0.113.5, 172.18.0.7")).toBe("203.0.113.5");
  });
  it("liefert unknown statt einer falschen Adresse", () => {
    expect(resolve("172.18.0.5", undefined)).toBe("unknown");
    expect(resolve("172.18.0.5", "nonsense")).toBe("unknown");
    expect(resolve("172.18.0.5", "172.18.0.9")).toBe("unknown");
    expect(resolve(undefined, "1.2.3.4")).toBe("unknown");
    expect(resolve("garbage", "1.2.3.4")).toBe("unknown");
  });
  it("normalisiert IPv4-mapped IPv6 und kommt mit IPv6 klar", () => {
    expect(normalizeIp("::ffff:172.18.0.5")).toBe("172.18.0.5");
    expect(resolve("::ffff:172.18.0.5", "2001:db8::1")).toBe("2001:db8::1");
    expect(resolve("::ffff:198.51.100.7", "1.1.1.1")).toBe("198.51.100.7");
  });
  it("ohne konfigurierte Proxys gilt immer die direkte Adresse", () => {
    expect(createIpResolver([])("203.0.113.9", "1.1.1.1")).toBe("203.0.113.9");
  });
});

describe("Sicherheits-Log", () => {
  const dir = mkdtempSync(join(tmpdir(), "seclog-"));
  const fixed = () => new Date("2026-11-04T12:43:12Z");
  it("Zeitstempel mit Offset (Winter- und Sommerzeit)", () => {
    expect(formatTimestamp(new Date("2026-11-04T12:43:12Z"))).toBe("2026-11-04T13:43:12+01:00");
    expect(formatTimestamp(new Date("2026-07-04T12:43:12Z"))).toBe("2026-07-04T14:43:12+02:00");
  });
  it("schreibt genau eine Zeile im festen Format, auch nach stdout", () => {
    const file = join(dir, "a.log");
    const out: string[] = [];
    const log = createSecurityLogger({ file, stdout: (l) => out.push(l), now: fixed });
    log.authFail("203.0.113.5", "invalid_token");
    const expected = "2026-11-04T13:43:12+01:00 SUBSPLIT_AUTHFAIL ip=203.0.113.5 reason=invalid_token";
    expect(readFileSync(file, "utf8")).toBe(expected + "\n");
    expect(out).toEqual([expected]);
    expect(expected).toMatch(/^\S+ SUBSPLIT_AUTHFAIL ip=\S+ reason=(invalid_token|admin_login)$/);
  });
  it("widerrufener Token -> NOTICE, kein AUTHFAIL", () => {
    const file = join(dir, "b.log");
    createSecurityLogger({ file, stdout: () => {}, now: fixed }).notice("203.0.113.5", "revoked_token");
    const text = readFileSync(file, "utf8");
    expect(text).toContain("SUBSPLIT_NOTICE ip=203.0.113.5 reason=revoked_token");
    expect(text).not.toContain("AUTHFAIL");
  });
  it("rotiert nach Größe", () => {
    const file = join(dir, "c.log");
    const log = createSecurityLogger({ file, maxBytes: 200, keep: 2, stdout: () => {}, now: fixed });
    for (let i = 0; i < 10; i++) log.authFail("203.0.113.5", "admin_login");
    expect(existsSync(file + ".1")).toBe(true);
    expect(existsSync(file + ".3")).toBe(false);
  });
  it("stürzt nicht ab, wenn die Datei nicht schreibbar ist", () => {
    const blocker = join(dir, "blocker");
    writeFileSync(blocker, "x");
    const out: string[] = [];
    const log = createSecurityLogger({ file: join(blocker, "x.log"), stdout: (l) => out.push(l), now: fixed });
    expect(() => log.authFail("unknown", "invalid_token")).not.toThrow();
    expect(out[0]).toContain("ip=unknown");
  });
});

describe("Tokens", () => {
  it("32 Byte Zufall, base64url, nur als Hash speicherbar", () => {
    const t = generateToken();
    expect(isWellFormedToken(t)).toBe(true);
    expect(Buffer.from(t, "base64url")).toHaveLength(32);
    expect(generateToken()).not.toBe(t);
    expect(hashToken(t)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(t)).not.toContain(t);
  });
  it("erkennt Müll", () => {
    for (const bad of ["", "abc", "x".repeat(44), "../../etc/passwd", "a".repeat(42) + "!"]) expect(isWellFormedToken(bad)).toBe(false);
  });
});

describe("Passwort", () => {
  it("hash/verify, falsches Passwort, kaputter Hash", () => {
    const h = hashPassword("korrektes-pferd-batterie", { N: 1024, r: 8, p: 1 });
    expect(h).not.toContain("$");
    expect(verifyPassword("korrektes-pferd-batterie", h)).toBe(true);
    expect(verifyPassword("falsch", h)).toBe(false);
    expect(verifyPassword("x", "müll")).toBe(false);
    expect(verifyPassword("x", "scrypt:3:8:1:aa:bb")).toBe(false);
  });
});

describe("Session / CSRF / Rate-Limit", () => {
  const secret = "s".repeat(40);
  const U = { uid: 7, sv: 2 };
  it("Session gültig, manipuliert, abgelaufen, anderes Secret", () => {
    const { value, payload } = createSession(secret, U, 1_000_000);
    expect(verifySession(value, secret, 1_000_000)?.csrf).toBe(payload.csrf);
    expect(verifySession(value, secret, 1_000_000)).toMatchObject({ uid: 7, sv: 2 });
    expect(verifySession(value + "x", secret, 1_000_000)).toBeNull();
    expect(verifySession(value, "anderes-secret-anderes-secret-xx", 1_000_000)).toBeNull();
    expect(verifySession(value, secret, 1_000_000 + 31 * 60 * 1000)).toBeNull(); // nach 30 min ohne Aktion abgelaufen
    expect(verifySession(undefined, secret)).toBeNull();
    const [body] = value.split(".");
    expect(verifySession(`${body}.`, secret)).toBeNull();
  });
  it("Inaktivitäts-Timeout: Standard 30 Minuten, Verlängerung bei Aktivität, gleiches CSRF-Token", () => {
    const t0 = 1_000_000;
    const { value, payload } = createSession(secret, U, t0);
    expect(verifySession(value, secret, t0 + 29 * 60 * 1000)).not.toBeNull();
    // Aktivität nach 20 min verlängert um weitere 30 min -> nach 45 min noch gültig
    const refreshed = refreshSession(payload, secret, t0 + 20 * 60 * 1000);
    const again = verifySession(refreshed, secret, t0 + 45 * 60 * 1000);
    expect(again?.csrf).toBe(payload.csrf);
    expect(verifySession(refreshed, secret, t0 + 51 * 60 * 1000)).toBeNull(); // 31 min nach der letzten Aktivität
    // einstellbar
    expect(verifySession(createSession(secret, U, t0, 60).value, secret, t0 + 61 * 1000)).toBeNull();
  });
  it("Cookie: Max-Age entspricht dem Timeout, HttpOnly/SameSite, Secure nur bei https", () => {
    expect(sessionCookie("x", true)).toMatch(/Max-Age=1800.*Secure|Secure.*Max-Age=1800|Max-Age=1800/);
    expect(sessionCookie("x", true)).toContain("Secure");
    expect(sessionCookie("x", false)).not.toContain("Secure");
    expect(sessionCookie("x", false, 600)).toContain("Max-Age=600");
    expect(sessionCookie("x", false)).toContain("HttpOnly");
    expect(sessionCookie("x", false)).toContain("SameSite=Strict");
  });
  it("CSRF: Origin und Token", () => {
    expect(isSameOrigin("https://abos.example.org", "https://abos.example.org")).toBe(true);
    expect(isSameOrigin("https://evil.example", "https://abos.example.org")).toBe(false);
    expect(isSameOrigin("null", "https://abos.example.org")).toBe(false);
    expect(csrfTokenValid("abc", "abc")).toBe(true);
    expect(csrfTokenValid("abd", "abc")).toBe(false);
    expect(csrfTokenValid(null, "abc")).toBe(false);
  });
  it("Rate-Limit blockiert nach max und gibt nach Fensterende frei", () => {
    let t = 0;
    const rl = new RateLimiter(3, 1000, () => t);
    expect([1, 2, 3, 4].map(() => rl.consume("ip"))).toEqual([true, true, true, false]);
    expect(rl.consume("andere-ip")).toBe(true);
    t = 1001;
    expect(rl.consume("ip")).toBe(true);
  });
});
