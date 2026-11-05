import { beforeEach, describe, expect, it } from "vitest";
import type { InviteSettings } from "@/lib/config";
import { openDatabase, runMigrations, type Db } from "@/db/client";
import type { SecurityLogger } from "@/lib/security/security-log";
import { AppError } from "@/lib/services/errors";
import {
  acceptInvitation, canCreateInvitations, createInvitation, DEFAULT_INVITE_SETTINGS, INVITE_TTL_MS, listInvitations, MAX_ACTIVE_INVITATIONS,
  peekInvitation, revokeInvitation, type Creator,
} from "@/lib/services/invitations";
import { authenticate, createUser, setDisabled } from "@/lib/services/users";
import { getOperatorAccounts } from "@/lib/services/views";

const NOW = new Date("2026-11-04T12:00:00Z");
const PW = "ein-sehr-langes-passwort";
let db: Db;
let calls: string[];
const logger: SecurityLogger = { authFail: (ip, r) => calls.push(`FAIL ${ip} ${r}`), notice: (ip, r) => calls.push(`NOTICE ${ip} ${r}`) };
let anna: Creator, bob: Creator, chef: Creator;
const days = (n: number) => new Date(NOW.getTime() + n * 24 * 3600 * 1000);
const D = DEFAULT_INVITE_SETTINGS;

beforeEach(() => {
  const h = openDatabase(":memory:");
  runMigrations(h, "./drizzle");
  db = h.db;
  calls = [];
  anna = { id: createUser(db, { username: "anna", displayName: "Anna" }), role: "user" };
  bob = { id: createUser(db, { username: "bob", displayName: "Bob" }), role: "user" };
  chef = { id: createUser(db, { username: "chef", displayName: "Chef", role: "operator" }), role: "operator" };
});

const create = (c: Creator, now = NOW, s: InviteSettings = D) => createInvitation(db, c, s, now);
const list = (c: Creator, now = NOW, s: InviteSettings = D) => listInvitations(db, c, s, now);
const peek = (t: string, now = NOW, s: InviteSettings = D) => peekInvitation(db, t, "1.2.3.4", logger, s, now);
const accept = (t: string, name = "neu", now = NOW, s: InviteSettings = D) => acceptInvitation(db, t, { username: name, displayName: "Neu " + name, password: PW }, s, now);

describe("Einladungslinks erzeugen", () => {
  it("Standard: höchstens 5 offene gleichzeitig pro Konto; ein anderes Konto hat sein eigenes Limit", () => {
    for (let i = 0; i < MAX_ACTIVE_INVITATIONS; i++) create(anna);
    expect(() => create(anna)).toThrow(/schon 5 offene/);
    create(bob);
    expect(list(anna)).toMatchObject({ max: 5, activeCount: 5, canCreate: true });
  });
  it("abgelaufene, eingelöste und widerrufene Links zählen nicht mehr zum Limit", () => {
    const tokens = Array.from({ length: 5 }, () => create(anna));
    expect(() => create(anna)).toThrow(AppError);
    accept(tokens[0]!);
    create(anna);
    revokeInvitation(db, anna.id, list(anna).items.find((i) => i.state === "open")!.id, NOW);
    create(anna);
    expect(() => create(anna)).toThrow(AppError);
    create(anna, days(8));
  });
  it("Links laufen nach 7 Tagen ab", () => {
    expect(INVITE_TTL_MS).toBe(7 * 24 * 3600 * 1000);
    const t = create(anna);
    expect(peek(t, days(6.9))).toBe(true);
    expect(peek(t, days(7.01))).toBe(false);
    expect(() => accept(t, "spaet", days(7.01))).toThrow(/ungültig oder abgelaufen/);
    expect(calls).toEqual(["NOTICE 1.2.3.4 revoked_token"]);
  });
});

describe("Einstellungen: wer darf einladen und wie viele", () => {
  const onlyOp: InviteSettings = { creators: "operator", maxActive: 5 };
  it("nur Betreiber: normale Konten können nichts erstellen, der Betreiber schon", () => {
    expect(canCreateInvitations(anna, onlyOp)).toBe(false);
    expect(() => create(anna, NOW, onlyOp)).toThrow(/nur der Betreiber/);
    expect(list(anna, NOW, onlyOp).canCreate).toBe(false);
    expect(typeof create(chef, NOW, onlyOp)).toBe("string");
    expect(list(chef, NOW, onlyOp).canCreate).toBe(true);
  });
  it("das Umstellen auf 'nur Betreiber' macht bereits erstellte Links normaler Konten sofort unbrauchbar (NOTICE, kein Ban)", () => {
    const fromAnna = create(anna);
    const fromChef = create(chef);
    expect(peek(fromAnna, NOW, D)).toBe(true);
    expect(peek(fromAnna, NOW, onlyOp)).toBe(false);
    expect(() => accept(fromAnna, "x", NOW, onlyOp)).toThrow(AppError);
    expect(peek(fromChef, NOW, onlyOp)).toBe(true); // Links des Betreibers bleiben gültig
    accept(fromChef, "gast", NOW, onlyOp);
    expect(calls).toEqual(["NOTICE 1.2.3.4 revoked_token"]);
    // wieder zurück auf 'alle': der Link von Anna funktioniert wieder (er war nur gesperrt, nicht gelöscht)
    expect(peek(fromAnna, NOW, D)).toBe(true);
  });
  it("eigenes Limit pro Konto (z. B. 2) und Absenken verändert bestehende Links nicht", () => {
    const two: InviteSettings = { creators: "all", maxActive: 2 };
    const t1 = create(anna, NOW, two); create(anna, NOW, two);
    expect(() => create(anna, NOW, two)).toThrow(/schon 2 offene/);
    expect(list(anna, NOW, two)).toMatchObject({ max: 2, activeCount: 2 });
    // höheres Limit erlaubt mehr, niedrigeres sperrt nur neue Links
    const ten: InviteSettings = { creators: "all", maxActive: 10 };
    for (let i = 0; i < 8; i++) create(anna, NOW, ten);
    expect(() => create(anna, NOW, ten)).toThrow(/schon 10 offene/);
    const one: InviteSettings = { creators: "all", maxActive: 1 };
    expect(() => create(anna, NOW, one)).toThrow(/schon 1 offene/);
    expect(peek(t1, NOW, one)).toBe(true);
  });
  it("Limit gilt für jedes Konto, auch für den Betreiber", () => {
    const two: InviteSettings = { creators: "all", maxActive: 2 };
    create(chef, NOW, two); create(chef, NOW, two);
    expect(() => create(chef, NOW, two)).toThrow(/schon 2 offene/);
  });
  it("0 schaltet Einladungen ganz ab, für alle (auch Betreiber) und macht offene Links unbrauchbar", () => {
    const off: InviteSettings = { creators: "all", maxActive: 0 };
    const t = create(chef);
    expect(canCreateInvitations(chef, off)).toBe(false);
    expect(() => create(chef, NOW, off)).toThrow(/abgeschaltet/);
    expect(list(chef, NOW, off)).toMatchObject({ max: 0, canCreate: false });
    expect(peek(t, NOW, off)).toBe(false);
  });
});

describe("Link einlösen", () => {
  it("der Eingeladene wählt Benutzername, Anzeigename und Passwort und kann sich danach anmelden", () => {
    const t = create(anna);
    expect(peek(t)).toBe(true);
    expect(calls).toEqual([]);
    const { userId } = accept(t, "Neuling");
    expect(authenticate(db, "neuling", PW, NOW)?.id).toBe(userId);
    const acc = getOperatorAccounts(db, { thresholdCents: 1, factor: 3 }, NOW).find((a) => a.username === "neuling")!;
    expect(acc).toMatchObject({ displayName: "Neu Neuling", role: "user", status: "active" });
  });
  it("ein Link gilt nur einmal; danach nur NOTICE, kein Ban", () => {
    const t = create(anna);
    accept(t, "erster");
    expect(() => accept(t, "zweiter")).toThrow(/ungültig oder abgelaufen/);
    expect(peek(t)).toBe(false);
    expect(calls).toEqual(["NOTICE 1.2.3.4 revoked_token"]);
  });
  it("unbekannter oder kaputter Link -> AUTHFAIL ohne den Token im Log", () => {
    const guess = "A".repeat(43);
    expect(peek(guess)).toBe(false);
    expect(peek("../x")).toBe(false);
    expect(calls).toEqual(["FAIL 1.2.3.4 invalid_token", "FAIL 1.2.3.4 invalid_token"]);
    expect(calls.join()).not.toContain(guess);
    expect(() => accept(guess)).toThrow(AppError);
  });
  it("vergebener Benutzername oder zu kurzes Passwort: Fehler, der Link bleibt unverbraucht", () => {
    const t = create(anna);
    expect(() => accept(t, "bob")).toThrow(/vergeben/);
    expect(() => acceptInvitation(db, t, { username: "frei", displayName: "Frei", password: "kurz" }, D, NOW)).toThrow(/12 Zeichen/);
    expect(() => acceptInvitation(db, t, { username: "!!", displayName: "Frei", password: PW }, D, NOW)).toThrow(/Benutzername/);
    expect(() => acceptInvitation(db, t, { username: "frei", displayName: "  ", password: PW }, D, NOW)).toThrow(/Anzeigename/);
    expect(peek(t)).toBe(true);
    accept(t, "frei");
  });
  it("sperrt der Betreiber den Ersteller, werden dessen offene Links ungültig", () => {
    const t = create(anna);
    setDisabled(db, anna.id, true, chef.id, NOW);
    expect(peek(t)).toBe(false);
    expect(() => accept(t)).toThrow(AppError);
  });
});

describe("Verwaltung der eigenen Einladungen", () => {
  it("Liste mit Status und Name des Eingeladenen; Links lassen sich nicht erneut anzeigen", () => {
    const used = create(anna);
    create(anna);
    accept(used, "gast");
    const l = list(anna);
    expect(l.items.map((i) => [i.state, i.usedBy]).sort()).toEqual([["open", null], ["used", "Neu gast"]]);
    expect(JSON.stringify(l)).not.toMatch(/token|hash/i);
    const later = list(anna, days(8));
    expect(later.items.map((i) => i.state).sort()).toEqual(["expired", "used"]);
    expect(later.activeCount).toBe(0);
  });
  it("nur der Ersteller kann einen offenen Link widerrufen, eingelöste nicht", () => {
    const t = create(anna);
    const id = list(anna).items[0]!.id;
    expect(() => revokeInvitation(db, bob.id, id, NOW)).toThrow(/nicht gefunden/);
    expect(list(bob).items).toEqual([]);
    revokeInvitation(db, anna.id, id, NOW);
    expect(peek(t)).toBe(false);
    expect(calls).toEqual(["NOTICE 1.2.3.4 revoked_token"]);
    const t2 = create(anna);
    accept(t2, "gast");
    const usedId = list(anna).items.find((i) => i.state === "used")!.id;
    expect(() => revokeInvitation(db, anna.id, usedId, NOW)).toThrow(AppError);
    expect(() => revokeInvitation(db, anna.id, 9999, NOW)).toThrow(AppError);
  });
});
