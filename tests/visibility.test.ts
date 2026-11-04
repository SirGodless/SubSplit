import { beforeEach, describe, expect, it } from "vitest";
import { openDatabase, runMigrations, type Db } from "@/db/client";
import { createSecurityLogger } from "@/lib/security/security-log";
import { createParticipant, createSubscription, endMembership, regenerateToken, revokeToken, setMembership, setPrice, AdminError } from "@/lib/services/admin";
import { ensureMonthPayments, setPaidByParticipant, setStatusByAdmin } from "@/lib/services/payments";
import { authenticateToken, getParticipantView } from "@/lib/services/participant-view";
import { payments } from "@/db/schema";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const NOW = new Date("2026-11-04T12:00:00Z"); // aktueller Monat: 2026-11
const MONTH = "2026-11";

let db: Db;
let ids: { owner: number; a: number; b: number; c: number; netflix: number; spotify: number; secret: number };
let tokens: { a: string; b: string; c: string };

beforeEach(() => {
  const h = openDatabase(":memory:");
  runMigrations(h, "./drizzle");
  db = h.db;
  const owner = createParticipant(db, { displayName: "Admin", isOwner: true });
  const a = createParticipant(db, { displayName: "Anna", email: "anna-geheim@example.org" });
  const b = createParticipant(db, { displayName: "Bob", email: "bob-geheim@example.org" });
  const c = createParticipant(db, { displayName: "Cleo", email: "cleo-geheim@example.org" });
  const netflix = createSubscription(db, { name: "Netflix", priceCents: 1999, validFromMonth: MONTH }, NOW);
  const spotify = createSubscription(db, { name: "Spotify", priceCents: 1700, validFromMonth: MONTH }, NOW);
  const secret = createSubscription(db, { name: "Geheimabo", priceCents: 900, validFromMonth: MONTH }, NOW);
  const m = (subscriptionId: number, participantId: number, weight = 1) => setMembership(db, { subscriptionId, participantId, weight, from: MONTH }, NOW);
  m(netflix, owner.id); m(netflix, a.id); m(netflix, b.id);
  m(spotify, a.id, 2); m(spotify, b.id);
  m(secret, c.id);
  ids = { owner: owner.id, a: a.id, b: b.id, c: c.id, netflix, spotify, secret };
  tokens = { a: a.token, b: b.token, c: c.token };
});

describe("Sichtbarkeit für Teilnehmer", () => {
  it("A sieht bei gemeinsamem Abo Namen und Anteile von B, aber keine fremden Geheimnisse", () => {
    const view = getParticipantView(db, ids.a, MONTH, NOW)!;
    const netflix = view.subscriptions.find((s) => s.name === "Netflix")!;
    expect(netflix.lines.map((l) => [l.displayName, l.amountCents, l.isYou])).toEqual([["Admin", 667, false], ["Anna", 666, true], ["Bob", 666, false]]);
    expect(netflix.lines.reduce((s, l) => s + l.amountCents, 0) + netflix.restCents).toBe(netflix.priceCents);

    const json = JSON.stringify(view);
    for (const forbidden of ["bob-geheim", "anna-geheim", "cleo-geheim", "@example.org", "email", "tokenHash", "token", tokens.a, tokens.b, tokens.c]) {
      expect(json.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
    // Bobs Referenz-ID, Status und Gesamtsumme tauchen nicht auf
    const bobPay = db.select().from(payments).all().find((p) => p.participantId === ids.b)!;
    expect(json).not.toContain(bobPay.referenceId);
    expect(Object.keys(view).sort()).toEqual(["displayName", "month", "months", "payment", "subscriptions", "totalCents"]);
    expect(Object.keys(netflix.lines[0]!).sort()).toEqual(["amountCents", "displayName", "isYou", "percent", "weight"]);
  });

  it("Abos ohne eigene Beteiligung sind nicht enthalten (Geheimabo von C)", () => {
    const view = getParticipantView(db, ids.a, MONTH, NOW)!;
    expect(view.subscriptions.map((s) => s.name).sort()).toEqual(["Netflix", "Spotify"]);
    expect(JSON.stringify(view)).not.toContain("Geheimabo");
    expect(JSON.stringify(view)).not.toContain("Cleo");
  });

  it("Gesamtbetrag ist die Summe der eigenen gerundeten Anteile; Monatszahlung existiert genau einmal", () => {
    const view = getParticipantView(db, ids.a, MONTH, NOW)!;
    expect(view.totalCents).toBe(666 + 1133);
    expect(view.payment?.amountCents).toBe(view.totalCents);
    expect(view.payment?.referenceId).toMatch(/^[A-Z2-9]{6}$/);
    getParticipantView(db, ids.a, MONTH, NOW);
    expect(db.select().from(payments).all().filter((p) => p.participantId === ids.a)).toHaveLength(1);
  });

  it("Admin hat keine Monatszahlung und keine Teilnehmer-Ansicht", () => {
    ensureMonthPayments(db, MONTH, NOW);
    expect(db.select().from(payments).all().some((p) => p.participantId === ids.owner)).toBe(false);
    expect(getParticipantView(db, ids.owner, MONTH, NOW)).toBeNull();
  });

  it("zukünftige und unbekannte Monate sind nicht abrufbar", () => {
    expect(getParticipantView(db, ids.a, "2026-12", NOW)).toBeNull();
    expect(getParticipantView(db, ids.a, "2026-05", NOW)).toBeNull();
    expect(() => getParticipantView(db, ids.a, "kaputt", NOW)).toThrow();
  });

  it("Status eines anderen bleibt unberührt, wenn A 'bezahlt' setzt; bestätigt ist gesperrt", () => {
    getParticipantView(db, ids.a, MONTH, NOW); getParticipantView(db, ids.b, MONTH, NOW);
    expect(setPaidByParticipant(db, ids.a, MONTH, true, NOW)).toBe("ok");
    expect(getParticipantView(db, ids.a, MONTH, NOW)!.payment?.status).toBe("marked_paid");
    expect(getParticipantView(db, ids.b, MONTH, NOW)!.payment?.status).toBe("open");
    expect(setPaidByParticipant(db, ids.a, MONTH, false, NOW)).toBe("ok");
    const pay = db.select().from(payments).all().find((p) => p.participantId === ids.a)!;
    setStatusByAdmin(db, pay.id, "confirmed", NOW);
    expect(setPaidByParticipant(db, ids.a, MONTH, false, NOW)).toBe("locked");
    expect(setPaidByParticipant(db, ids.a, "2026-10", true, NOW)).toBe("not_found");
  });

  it("vergangene Monate bleiben nach Preiserhöhung unverändert", () => {
    const later = new Date("2026-12-02T10:00:00Z");
    const before = getParticipantView(db, ids.a, MONTH, NOW)!;
    setPrice(db, ids.netflix, "2026-12", 2499, later);
    const dec = getParticipantView(db, ids.a, "2026-12", later)!;
    const nov = getParticipantView(db, ids.a, MONTH, later)!;
    expect(nov.totalCents).toBe(before.totalCents);
    expect(dec.totalCents).toBeGreaterThan(before.totalCents);
    expect(dec.months).toEqual(["2026-12", "2026-11"]);
  });
});

describe("Änderungsregeln", () => {
  it("nach erzeugten Zahlungen sind Änderungen für diesen Monat gesperrt, ab nächstem Monat erlaubt", () => {
    ensureMonthPayments(db, MONTH, NOW);
    expect(() => setMembership(db, { subscriptionId: ids.netflix, participantId: ids.c, weight: 1, from: MONTH }, NOW)).toThrow(AdminError);
    expect(() => setPrice(db, ids.netflix, "2026-10", 100, NOW)).toThrow(AdminError);
    setMembership(db, { subscriptionId: ids.netflix, participantId: ids.c, weight: 1, from: "2026-12" }, NOW);
  });
  it("Entfernen wirkt ab dem Folgemonat, Gewichtsänderung ersetzt den Zeitraum ohne Überlappung", () => {
    const dec = new Date("2026-12-01T10:00:00Z");
    ensureMonthPayments(db, MONTH, NOW);
    endMembership(db, { subscriptionId: ids.netflix, participantId: ids.b, lastMonth: MONTH }, NOW);
    setMembership(db, { subscriptionId: ids.spotify, participantId: ids.a, weight: 3, from: "2026-12" }, NOW);
    const v = getParticipantView(db, ids.b, "2026-12", dec)!;
    expect(v.subscriptions.map((s) => s.name)).toEqual(["Spotify"]);
    const spotifyDec = getParticipantView(db, ids.a, "2026-12", dec)!.subscriptions.find((s) => s.name === "Spotify")!;
    expect(spotifyDec.lines.map((l) => l.weight)).toEqual([3, 1]);
    const spotifyNov = getParticipantView(db, ids.a, MONTH, dec)!.subscriptions.find((s) => s.name === "Spotify")!;
    expect(spotifyNov.lines.map((l) => l.weight)).toEqual([2, 1]);
  });
});

describe("Token-Prüfung und Sicherheits-Log", () => {
  const dir = mkdtempSync(join(tmpdir(), "vis-"));
  const mk = (name: string) => {
    const file = join(dir, name);
    return { file, logger: createSecurityLogger({ file, stdout: () => {}, now: () => NOW }) };
  };

  it("gültiger Token -> ok, keine Logzeile", () => {
    const { file, logger } = mk("ok.log");
    expect(authenticateToken(db, tokens.a, "203.0.113.5", logger)).toEqual({ kind: "ok", participantId: ids.a });
    expect(existsSync(file)).toBe(false);
  });

  it("unbekannter Token -> genau eine AUTHFAIL-Zeile ohne den Token", () => {
    const { file, logger } = mk("unknown.log");
    const guess = "A".repeat(43);
    expect(authenticateToken(db, guess, "203.0.113.5", logger)).toEqual({ kind: "denied" });
    const text = readFileSync(file, "utf8");
    expect(text.trim().split("\n")).toHaveLength(1);
    expect(text).toBe("2026-11-04T13:00:00+01:00 SUBSPLIT_AUTHFAIL ip=203.0.113.5 reason=invalid_token\n");
    expect(text).not.toContain(guess);
  });

  it("formal ungültiger Token (Müll, Pfad-Tricks) wird ebenfalls als invalid_token gezählt, ohne Inhalt im Log", () => {
    const { file, logger } = mk("junk.log");
    expect(authenticateToken(db, "../../etc/passwd", "198.51.100.1", logger).kind).toBe("denied");
    const text = readFileSync(file, "utf8");
    expect(text).toContain("reason=invalid_token");
    expect(text).not.toContain("passwd");
  });

  it("widerrufener Token -> gleiches Ergebnis wie unbekannt, aber NOTICE statt AUTHFAIL", () => {
    const { file, logger } = mk("revoked.log");
    revokeToken(db, ids.a, NOW);
    expect(authenticateToken(db, tokens.a, "203.0.113.5", logger)).toEqual({ kind: "denied" });
    const text = readFileSync(file, "utf8");
    expect(text).toContain("SUBSPLIT_NOTICE ip=203.0.113.5 reason=revoked_token");
    expect(text).not.toContain("AUTHFAIL");
    expect(text).not.toContain(tokens.a);
  });

  it("neu erzeugter Link macht den alten ungültig und den neuen gültig", () => {
    const { logger } = mk("regen.log");
    const fresh = regenerateToken(db, ids.a);
    expect(authenticateToken(db, tokens.a, "203.0.113.5", logger).kind).toBe("denied");
    expect(authenticateToken(db, fresh, "203.0.113.5", logger).kind).toBe("ok");
  });
});
