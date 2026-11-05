import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { openDatabase, runMigrations, type Db } from "@/db/client";
import { subscriptions, users } from "@/db/schema";
import type { SecurityLogger } from "@/lib/security/security-log";
import { AppError } from "@/lib/services/errors";
import {
  assertCanOwnSubscriptions, authenticate, bootstrapSetupToken, changePassword, completeSetup, createSetupLink, createUser, ensureOperator,
  getSessionUser, listDirectory, normalizeUsername, peekSetupToken, setDisabled, updateProfile, updateRecipient,
} from "@/lib/services/users";

const NOW = new Date("2026-11-04T12:00:00Z");
const PW = "ein-sehr-langes-passwort";
let db: Db;
let calls: string[];
const logger: SecurityLogger = { authFail: (ip, r) => calls.push(`FAIL ${ip} ${r}`), notice: (ip, r) => calls.push(`NOTICE ${ip} ${r}`) };

beforeEach(() => {
  const h = openDatabase(":memory:");
  runMigrations(h, "./drizzle");
  db = h.db;
  calls = [];
});

function activeUser(name: string, role: "operator" | "user" = "user") {
  const id = createUser(db, { username: name, displayName: name, role });
  completeSetup(db, createSetupLink(db, id, NOW), PW, NOW);
  return id;
}

describe("Konten anlegen", () => {
  it("normalisiert und validiert Benutzernamen, Anzeigenamen und E-Mail", () => {
    expect(normalizeUsername("  Anna.M  ")).toBe("anna.m");
    for (const bad of ["ab", "a b", "ÄÖÜ", "-anna", "x".repeat(31), ""]) expect(() => normalizeUsername(bad), bad).toThrow(AppError);
    expect(() => createUser(db, { username: "anna", displayName: "" })).toThrow(/Anzeigename/);
    expect(() => createUser(db, { username: "anna", displayName: "A", email: "kaputt" })).toThrow(/E-Mail/);
  });
  it("Benutzername ist eindeutig, auch bei anderer Groß-/Kleinschreibung", () => {
    createUser(db, { username: "anna", displayName: "Anna" });
    expect(() => createUser(db, { username: "ANNA", displayName: "Zweite" })).toThrow(/vergeben/);
  });
});

describe("Einrichtungslink", () => {
  it("Passwort wird über den Link gesetzt, danach ist Login möglich und der Link verbraucht", () => {
    const id = createUser(db, { username: "anna", displayName: "Anna" });
    expect(authenticate(db, "anna", PW, NOW)).toBeNull(); // noch kein Passwort
    const token = createSetupLink(db, id, NOW);
    const peek = peekSetupToken(db, token, "203.0.113.5", logger, NOW);
    expect(peek).toMatchObject({ kind: "ok", userId: id, username: "anna" });
    expect(calls).toEqual([]);
    expect(() => completeSetup(db, token, "kurz", NOW)).toThrow(/12 Zeichen/);
    completeSetup(db, token, PW, NOW);
    expect(authenticate(db, "Anna", PW, NOW)?.id).toBe(id);
    expect(peekSetupToken(db, token, "203.0.113.5", logger, NOW).kind).toBe("denied"); // verbraucht
    expect(() => completeSetup(db, token, PW, NOW)).toThrow(/ungültig oder abgelaufen/);
  });
  it("unbekannter Link -> AUTHFAIL, abgelaufener Link -> nur NOTICE", () => {
    const id = createUser(db, { username: "anna", displayName: "Anna" });
    expect(peekSetupToken(db, "A".repeat(43), "203.0.113.5", logger, NOW).kind).toBe("denied");
    expect(peekSetupToken(db, "../x", "203.0.113.5", logger, NOW).kind).toBe("denied");
    const token = createSetupLink(db, id, NOW);
    const later = new Date(NOW.getTime() + 8 * 24 * 3600 * 1000);
    expect(peekSetupToken(db, token, "203.0.113.5", logger, later).kind).toBe("denied");
    expect(() => completeSetup(db, token, PW, later)).toThrow(AppError);
    expect(calls).toEqual(["FAIL 203.0.113.5 invalid_token", "FAIL 203.0.113.5 invalid_token", "NOTICE 203.0.113.5 revoked_token"]);
    expect(calls.join()).not.toContain(token);
  });
  it("ein neuer Link macht den alten ungültig; gesperrte Konten bekommen keinen", () => {
    const id = createUser(db, { username: "anna", displayName: "Anna" });
    const first = createSetupLink(db, id, NOW);
    const second = createSetupLink(db, id, NOW);
    expect(peekSetupToken(db, first, "1.2.3.4", logger, NOW).kind).toBe("denied");
    expect(peekSetupToken(db, second, "1.2.3.4", logger, NOW).kind).toBe("ok");
    const op = activeUser("chef", "operator");
    setDisabled(db, id, true, op, NOW);
    expect(() => createSetupLink(db, id, NOW)).toThrow(AppError);
  });
});

describe("Login und Sitzung", () => {
  it("falsches Passwort, unbekannter Benutzer, ungültiges Format, gesperrtes Konto -> null", () => {
    const op = activeUser("chef", "operator");
    const id = activeUser("anna");
    expect(authenticate(db, "anna", "falsch-falsch-falsch", NOW)).toBeNull();
    expect(authenticate(db, "niemand", PW, NOW)).toBeNull();
    expect(authenticate(db, "!!", PW, NOW)).toBeNull();
    setDisabled(db, id, true, op, NOW);
    expect(authenticate(db, "anna", PW, NOW)).toBeNull();
    setDisabled(db, id, false, op, NOW);
    expect(authenticate(db, "anna", PW, NOW)?.id).toBe(id);
  });
  it("Passwortwechsel und Sperre beenden bestehende Sitzungen", () => {
    const op = activeUser("chef", "operator");
    const id = activeUser("anna");
    const a = authenticate(db, "anna", PW, NOW)!;
    expect(getSessionUser(db, id, a.sessionVersion)?.id).toBe(id);
    expect(() => changePassword(db, id, "falsch-falsch-falsch", "neues-langes-passwort")).toThrow(/stimmt nicht/);
    const sv = changePassword(db, id, PW, "neues-langes-passwort");
    expect(getSessionUser(db, id, a.sessionVersion)).toBeNull();
    expect(getSessionUser(db, id, sv)?.id).toBe(id);
    expect(authenticate(db, "anna", PW, NOW)).toBeNull();
    expect(authenticate(db, "anna", "neues-langes-passwort", NOW)).not.toBeNull();
    setDisabled(db, id, true, op, NOW);
    expect(getSessionUser(db, id, sv)).toBeNull();
  });
  it("sich selbst und den letzten Betreiber kann man nicht sperren", () => {
    const op = activeUser("chef", "operator");
    expect(() => setDisabled(db, op, true, op, NOW)).toThrow(/selbst/);
    const op2 = activeUser("chef2", "operator");
    expect(() => setDisabled(db, op, true, op2, NOW)).not.toThrow();
    expect(() => setDisabled(db, op2, true, op, NOW)).toThrow(AppError); // op ist gesperrt, aber op2 der letzte
  });
});

describe("Empfängerdaten", () => {
  it("validiert IBAN (Prüfsumme), lehnt die Beispiel-IBAN ab, normalisiert", () => {
    const id = activeUser("anna");
    expect(() => updateRecipient(db, id, { iban: "DE89370400440532013001" })).toThrow(/ungültig/);
    expect(() => updateRecipient(db, id, { iban: "DE89 3704 0044 0532 0130 00" })).toThrow(/Beispiel-IBAN/);
    updateRecipient(db, id, { iban: "GB82 WEST 1234 5698 7654 32", recipientName: "  Anna Muster ", dueDay: 15 });
    const row = db.select().from(users).where(eq(users.id, id)).get()!;
    expect(row.iban).toBe("GB82WEST12345698765432");
    expect(row.recipientName).toBe("Anna Muster");
    expect(row.dueDay).toBe(15);
  });
  it("PayPal.Me-Name: nur Buchstaben/Ziffern, URL-Einfügen wird bereinigt", () => {
    const id = activeUser("anna");
    for (const bad of ["max muster", "max?x=1", "a".repeat(21), "max-muster"]) expect(() => updateRecipient(db, id, { paypalMe: bad }), bad).toThrow(/PayPal/);
    updateRecipient(db, id, { paypalMe: "https://paypal.me/MaxMuster/" });
    expect(db.select().from(users).where(eq(users.id, id)).get()!.paypalMe).toBe("MaxMuster");
    updateRecipient(db, id, { paypalMe: "paypal.me/Anna1" });
    expect(db.select().from(users).where(eq(users.id, id)).get()!.paypalMe).toBe("Anna1");
  });
  it("Fälligkeitstag 1-28", () => {
    const id = activeUser("anna");
    for (const bad of [0, 29, 1.5, -1]) expect(() => updateRecipient(db, id, { dueDay: bad }), String(bad)).toThrow(/1 und 28/);
    updateRecipient(db, id, { dueDay: 28 });
  });
  it("ohne IBAN und PayPal kein Abo; mit Abos lassen sich nicht beide Wege entfernen", () => {
    const id = activeUser("anna");
    expect(() => assertCanOwnSubscriptions(db, id)).toThrow(/IBAN oder PayPal/);
    updateRecipient(db, id, { paypalMe: "Anna1" });
    assertCanOwnSubscriptions(db, id);
    db.insert(subscriptions).values({ ownerUserId: id, name: "Netflix" }).run();
    expect(() => updateRecipient(db, id, { paypalMe: null })).toThrow(/mindestens/);
    updateRecipient(db, id, { iban: "GB82 WEST 1234 5698 7654 32" });
    updateRecipient(db, id, { paypalMe: null }); // IBAN bleibt -> erlaubt
  });
  it("Profil: Anzeigename und E-Mail", () => {
    const id = activeUser("anna");
    updateProfile(db, id, { displayName: "Anna M.", email: "anna@example.org" });
    expect(() => updateProfile(db, id, { email: "kaputt" })).toThrow(/E-Mail/);
    expect(db.select().from(users).where(eq(users.id, id)).get()).toMatchObject({ displayName: "Anna M.", email: "anna@example.org" });
  });
});

describe("Ersteinrichtung und Verzeichnis", () => {
  it("ensureOperator legt genau einen Betreiber an; bootstrapSetupToken liefert einen Link bis das Passwort gesetzt ist", () => {
    const a = ensureOperator(db);
    expect(a.created).toBe(true);
    expect(ensureOperator(db)).toEqual({ id: a.id, created: false });
    const boot = bootstrapSetupToken(db, NOW)!;
    expect(boot.username).toBe("admin");
    expect(peekSetupToken(db, boot.token, "1.2.3.4", logger, NOW).kind).toBe("ok");
    expect(peekSetupToken(db, boot.token, "1.2.3.4", logger, new Date(NOW.getTime() + 25 * 3600 * 1000)).kind).toBe("denied"); // 24 h
    completeSetup(db, bootstrapSetupToken(db, NOW)!.token, PW, NOW);
    expect(bootstrapSetupToken(db, NOW)).toBeNull();
  });
  it("Verzeichnis zeigt nur Anzeigename und Benutzername aktiver Konten", () => {
    const op = activeUser("chef", "operator");
    const id = activeUser("anna");
    updateRecipient(db, id, { iban: "GB82 WEST 1234 5698 7654 32" });
    const x = activeUser("bob");
    setDisabled(db, x, true, op, NOW);
    const dir = listDirectory(db);
    expect(dir.map((d) => d.username).sort()).toEqual(["anna", "chef"]);
    expect(Object.keys(dir[0]!).sort()).toEqual(["displayName", "id", "username"]);
    expect(JSON.stringify(dir)).not.toContain("GB82");
  });
});
