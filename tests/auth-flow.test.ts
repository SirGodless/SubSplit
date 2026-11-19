import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { openDatabase, runMigrations, type Db } from "@/db/client";
import { sessions, users } from "@/db/schema";
import { HubApi } from "@/lib/hub/client";
import { resetIdentities } from "@/lib/hub/identity";
import { HubOidc } from "@/lib/hub/oidc";
import { POST as backchannelLogout } from "@/app/auth/backchannel-logout/route";
import { GET as callback } from "@/app/auth/callback/route";
import { GET as login } from "@/app/auth/login/route";
import { POST as logout } from "@/app/api/auth/logout/route";
import { RateLimiter } from "@/lib/security/rate-limit";
import { authenticate } from "@/lib/server/session-auth";
import { userRoute } from "@/lib/server/http";
import { findSession, sessionHash } from "@/lib/services/sessions";
import { createMockHub, hubUser, HUB_CONFIG, type MockHub } from "./mock-hub";

const BASE = "https://abos.example.org";
const ANNA = "3f0c1d2e-7a55-4a3e-9d0b-0f6c1b7f1a11";
const BEN = "9b1f0a2c-4d3e-4f50-8a61-7c2d3e4f5a6b";
let db: Db;
let hub: MockHub;
let oidc: HubOidc;
let api: HubApi;
const deps = () => ({ db, oidc, hub: api, idleSeconds: 1800 });

beforeEach(async () => {
  const h = openDatabase(":memory:");
  runMigrations(h, "./drizzle");
  db = h.db;
  hub = await createMockHub();
  hub.users.set(ANNA, hubUser(ANNA, "anna"));
  hub.users.set(BEN, hubUser(BEN, "ben"));
  oidc = new HubOidc(HUB_CONFIG, hub.fetch);
  api = new HubApi(oidc, HUB_CONFIG.clientId);
  resetIdentities();
  (globalThis as unknown as { __subsplitCtx: unknown }).__subsplitCtx = {
    config: { baseUrl: BASE, sessionSecret: "s".repeat(40), idleSeconds: 1800, hub: HUB_CONFIG },
    db, oidc, hub: api,
    logger: { authFail: () => {}, notice: () => {} },
    resolveIp: () => "203.0.113.5",
    loginLimiter: new RateLimiter(20, 60_000), tokenLimiter: new RateLimiter(120, 60_000),
  };
});

const cookieOf = (res: Response, name: string) => {
  const line = res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`));
  return line ? line.split(";")[0]!.slice(name.length + 1) : undefined;
};

/** Durchläuft die Anmeldung: /auth/login, dann (mit Code des Mock-Hubs) /auth/callback. */
async function signIn(sub: string, opts: { sid?: string; next?: string; state?: string } = {}): Promise<{ res: Response; token: string | undefined }> {
  const start = await login(new Request(`${BASE}/auth/login${opts.next ? `?next=${encodeURIComponent(opts.next)}` : ""}`));
  const authorize = new URL(start.headers.get("location")!);
  const oidcCookie = cookieOf(start, "subsplit_oidc")!;
  hub.codes.set("code-1", { sub, sid: opts.sid ?? "hub-sid-1", nonce: authorize.searchParams.get("nonce")! });
  const res = await callback(new Request(`${BASE}/auth/callback?code=code-1&state=${opts.state ?? authorize.searchParams.get("state")}`, { headers: { cookie: `subsplit_oidc=${oidcCookie}` } }));
  return { res, token: cookieOf(res, "subsplit_session") };
}

describe("Anmeldung über den Hub", () => {
  it("/auth/login leitet zum Hub (Code-Flow mit PKCE) und merkt sich state, nonce und Verifier in einem signierten Cookie", async () => {
    const res = await login(new Request(`${BASE}/auth/login?next=/manage`));
    expect(res.status).toBe(302);
    const u = new URL(res.headers.get("location")!);
    expect(u.origin).toBe("https://hub.example");
    expect(u.searchParams.get("redirect_uri")).toBe(`${BASE}/auth/callback`);
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    const cookie = res.headers.getSetCookie().find((c) => c.startsWith("subsplit_oidc="))!;
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).toMatch(/Secure/);
    expect(cookie).not.toContain(u.searchParams.get("code_challenge")!); // der Verifier ist im Cookie, die Challenge nicht nötig
  });
  it("Ein Hub, der nicht antwortet, führt zur Fehlerseite statt zu einer Schleife", async () => {
    hub.down = true;
    oidc = new HubOidc(HUB_CONFIG, hub.fetch);
    (globalThis as unknown as { __subsplitCtx: { oidc: HubOidc } }).__subsplitCtx.oidc = oidc;
    expect((await login(new Request(`${BASE}/auth/login`))).headers.get("location")).toBe(`${BASE}/login?error=hub_unavailable`);
  });
  it("Rücksprung: legt Konto und Sitzung an, setzt das Cookie und leitet zum gemerkten Ziel", async () => {
    hub.operators.add(ANNA);
    const { res, token } = await signIn(ANNA, { next: "/manage", sid: "hub-sid-1" });
    expect(res.headers.get("location")).toBe(`${BASE}/manage`);
    expect(token).toBeTruthy();
    const sessionCookie = res.headers.getSetCookie().find((c) => c.startsWith("subsplit_session="))!;
    expect(sessionCookie).toMatch(/HttpOnly.*SameSite=Strict|SameSite=Strict.*HttpOnly/);
    expect(res.headers.getSetCookie().some((c) => c.startsWith("subsplit_oidc=;"))).toBe(true); // Weiterleitungs-Cookie weg
    const user = db.select().from(users).where(eq(users.sub, ANNA)).get()!;
    expect(user.lastLoginAt).not.toBeNull();
    const row = db.select().from(sessions).get()!;
    expect(row).toMatchObject({ userId: user.id, hubSid: "hub-sid-1", operator: true });
    expect(row.refreshToken).toBe("r-1");
    expect(row.idHash).toBe(sessionHash(token!)); // gespeichert wird nur der Hash
    expect(JSON.stringify(row)).not.toContain(token!);
  });
  it("ein zweiter Login desselben Kontos legt kein zweites lokales Konto an", async () => {
    await signIn(ANNA);
    await signIn(ANNA);
    expect(db.select().from(users).all()).toHaveLength(1);
    expect(db.select().from(sessions).all()).toHaveLength(2);
  });
  it("falscher state oder fehlendes Cookie: keine Sitzung", async () => {
    const wrong = await signIn(ANNA, { state: "falsch" });
    expect(wrong.res.headers.get("location")).toBe(`${BASE}/login?error=state`);
    const none = await callback(new Request(`${BASE}/auth/callback?code=x&state=y`));
    expect(none.headers.get("location")).toBe(`${BASE}/login?error=state`);
    expect(db.select().from(sessions).all()).toHaveLength(0);
    expect(db.select().from(users).all()).toHaveLength(0);
  });
  it("ohne Zugang laut Hub: keine Sitzung, Hinweis", async () => {
    hub.users.set(BEN, hubUser(BEN, "ben", { access: false }));
    const { res } = await signIn(BEN);
    expect(res.headers.get("location")).toBe(`${BASE}/login?error=no_access`);
    expect(db.select().from(sessions).all()).toHaveLength(0);
  });
  it("ein Code gilt nur einmal", async () => {
    const start = await login(new Request(`${BASE}/auth/login`));
    const authorize = new URL(start.headers.get("location")!);
    const cookie = `subsplit_oidc=${cookieOf(start, "subsplit_oidc")}`;
    hub.codes.set("code-1", { sub: ANNA, nonce: authorize.searchParams.get("nonce")! });
    const url = `${BASE}/auth/callback?code=code-1&state=${authorize.searchParams.get("state")}`;
    expect((await callback(new Request(url, { headers: { cookie } }))).headers.get("location")).toBe(`${BASE}/`);
    expect((await callback(new Request(url, { headers: { cookie } }))).headers.get("location")).toBe(`${BASE}/login?error=failed`);
  });
  it("das Ziel nach der Anmeldung muss innerhalb der App liegen (kein Open Redirect)", async () => {
    for (const next of ["//boese.example", "https://boese.example", "/\\boese.example"]) {
      const { res } = await signIn(ANNA, { next });
      expect(res.headers.get("location"), next).toBe(`${BASE}/`);
    }
  });
});

describe("Sitzung und Zugangsprüfung beim Hub", () => {
  const later = (minutes: number) => new Date(Date.now() + minutes * 60_000);

  it("Sitzung gilt, ohne Prüfung vor Ablauf der 5 Minuten; danach wird das Refresh-Token eingelöst und die Rolle neu gelesen", async () => {
    const { token } = await signIn(ANNA);
    expect((await authenticate(deps(), token))?.user).toMatchObject({ username: "anna", role: "user" });
    const calls = hub.calls.length;
    await authenticate(deps(), token, later(2));
    expect(hub.calls.filter((c) => c.includes("grant")).length + hub.calls.length - calls).toBe(hub.calls.length - calls); // kein Refresh nötig
    expect(hub.calls.some((c, i) => i >= calls && c === "POST /oauth2/token")).toBe(false);

    hub.operators.add(ANNA); // im Hub wurde das Recht vergeben
    const auth = await authenticate(deps(), token, later(6));
    expect(auth?.user.role).toBe("operator");
    expect(db.select().from(sessions).get()!.refreshToken).toBe("r-2"); // rotiert und gespeichert
  });
  it("Bann im Hub (Refresh abgelehnt): Sitzung wird beendet", async () => {
    const { token } = await signIn(ANNA);
    hub.refreshTokens.clear(); // der Hub hat die Autorisierung gelöscht
    expect(await authenticate(deps(), token, later(6))).toBeNull();
    expect(db.select().from(sessions).all()).toHaveLength(0);
    expect(await authenticate(deps(), token, later(7))).toBeNull();
  });
  it("Recht auf SubSplit entzogen (access false): Sitzung wird beendet", async () => {
    const { token } = await signIn(ANNA);
    hub.users.set(ANNA, hubUser(ANNA, "anna", { access: false }));
    expect(await authenticate(deps(), token, later(6))).toBeNull();
    expect(db.select().from(sessions).all()).toHaveLength(0);
  });
  it("Hub nicht erreichbar: Sitzung bleibt, neuer Versuch in einer Minute", async () => {
    const { token } = await signIn(ANNA);
    hub.down = true;
    expect(await authenticate(deps(), token, later(6))).not.toBeNull();
    const row = db.select().from(sessions).get()!;
    expect(Date.parse(row.checkAt)).toBeLessThan(later(6).getTime() + 62_000); // in etwa einer Minute erneut
    hub.down = false;
    expect(await authenticate(deps(), token, later(8))).not.toBeNull();
    expect(db.select().from(sessions).get()!.refreshToken).toBe("r-2");
  });
  it("gleichzeitige Anfragen lösen das Refresh-Token nur einmal ein (es gilt sonst nur einmal)", async () => {
    const { token } = await signIn(ANNA);
    const when = later(6);
    const results = await Promise.all([1, 2, 3, 4].map(() => authenticate(deps(), token, when)));
    expect(results.every((r) => r !== null)).toBe(true);
    expect(hub.calls.filter((c) => c === "POST /oauth2/token").length).toBe(3); // 1x Dienst-Token, 1x Code (Anmeldung), 1x Refresh
  });
  it("Inaktivität: nach 30 Minuten ohne Aktion ist die Sitzung weg, Aktivität verlängert", async () => {
    const { token } = await signIn(ANNA);
    expect(findSession(db, token, later(29))).not.toBeNull();
    await authenticate(deps(), token, later(25)); // verlängert um weitere 30 Minuten ab dann
    expect(findSession(db, token, later(50))).not.toBeNull();
    expect(findSession(db, token, later(56))).toBeNull();
  });
});

describe("Back-Channel-Logout", () => {
  const post = (token: string | undefined) => backchannelLogout(new Request(`${BASE}/auth/backchannel-logout`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: token === undefined ? "" : new URLSearchParams({ logout_token: token }),
  }));

  it("mit sid endet nur die Sitzung aus dieser Hub-Sitzung, andere Geräte und andere Nutzer bleiben", async () => {
    const laptop = (await signIn(ANNA, { sid: "sid-laptop" })).token!;
    const phone = (await signIn(ANNA, { sid: "sid-phone" })).token!;
    const ben = (await signIn(BEN, { sid: "sid-ben" })).token!;
    const res = await post(await hub.logoutToken({ sub: ANNA, sid: "sid-laptop" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(findSession(db, laptop)).toBeNull();
    expect(findSession(db, phone)).not.toBeNull();
    expect(findSession(db, ben)).not.toBeNull();
  });
  it("ohne sid (Bann, Reset im Hub) enden alle Sitzungen dieses Nutzers", async () => {
    const a1 = (await signIn(ANNA, { sid: "s1" })).token!;
    const a2 = (await signIn(ANNA, { sid: "s2" })).token!;
    const ben = (await signIn(BEN, { sid: "s3" })).token!;
    expect((await post(await hub.logoutToken({ sub: ANNA }))).status).toBe(200);
    expect(findSession(db, a1)).toBeNull();
    expect(findSession(db, a2)).toBeNull();
    expect(findSession(db, ben)).not.toBeNull();
  });
  it("dasselbe Token ein zweites Mal wird abgelehnt (jti)", async () => {
    await signIn(ANNA, { sid: "s1" });
    const t = await hub.logoutToken({ sub: ANNA, sid: "s1" });
    expect((await post(t)).status).toBe(200);
    expect((await post(t)).status).toBe(400);
  });
  it("ungültige Tokens ändern nichts und bekommen 400", async () => {
    const tok = (await signIn(ANNA, { sid: "s1" })).token!;
    for (const bad of [undefined, "murks", await hub.idToken({ sub: ANNA, nonce: "n", sid: "s1" }), await hub.logoutToken({ sub: ANNA, sid: "s1", aud: "anderer" }), await hub.logoutToken({ sub: ANNA, sid: "s1", nonce: "n" })]) {
      expect((await post(bad)).status, String(bad).slice(0, 20)).toBe(400);
    }
    expect(findSession(db, tok)).not.toBeNull();
  });
});

describe("Abmelden und geschützte Routen", () => {
  const route = userRoute(({ user }) => ({ name: user.username }));
  const writeRoute = userRoute(() => ({ ok: true }));
  const withCookie = (token: string | undefined, init: RequestInit = {}) => new Request(`${BASE}/x`, { ...init, headers: { ...(token ? { cookie: `subsplit_session=${token}` } : {}), ...(init.headers as Record<string, string>) } });

  it("ohne Sitzung 401, mit Sitzung die Daten des Kontos", async () => {
    expect((await route(withCookie(undefined), { params: Promise.resolve({}) })).status).toBe(401);
    const { token } = await signIn(ANNA);
    const res = await route(withCookie(token), { params: Promise.resolve({}) });
    expect(await res.json()).toEqual({ name: "anna" });
    expect(res.headers.getSetCookie()[0]).toContain("Max-Age=1800"); // gleitender Timeout
  });
  it("Schreibende Anfragen brauchen Origin und das CSRF-Token der Sitzung", async () => {
    const { token } = await signIn(ANNA);
    const csrf = db.select().from(sessions).get()!.csrf;
    const call = (headers: Record<string, string>) => writeRoute(withCookie(token, { method: "POST", headers }), { params: Promise.resolve({}) });
    expect((await call({})).status).toBe(403);
    expect((await call({ "x-csrf-token": "falsch" })).status).toBe(403);
    expect((await call({ "x-csrf-token": csrf, origin: "https://boese.example" })).status).toBe(403);
    expect((await call({ "x-csrf-token": csrf, origin: BASE })).status).toBe(200);
  });
  it("Abmelden in SubSplit löscht die Sitzung und das Cookie, der Hub bleibt unberührt", async () => {
    const { token } = await signIn(ANNA);
    const csrf = db.select().from(sessions).get()!.csrf;
    const res = await logout(withCookie(token, { method: "POST", headers: { "x-csrf-token": csrf } }), { params: Promise.resolve({}) });
    expect(res.status).toBe(200);
    expect(res.headers.getSetCookie()[0]).toContain("Max-Age=0");
    expect(findSession(db, token)).toBeNull();
    expect(hub.calls.some((c) => c.includes("logout"))).toBe(false);
  });
  it("Betreiber-Routen sind nur mit dem Recht im Hub offen", async () => {
    const op = userRoute(() => ({ ok: true }), { operator: true });
    const user = (await signIn(ANNA)).token;
    expect((await op(withCookie(user), { params: Promise.resolve({}) })).status).toBe(403);
    hub.operators.add(BEN);
    const boss = (await signIn(BEN)).token;
    expect((await op(withCookie(boss), { params: Promise.resolve({}) })).status).toBe(200);
  });
});
