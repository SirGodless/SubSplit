import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { initDatabase, isPlainSqliteFile, openDatabase, runMigrations, closeDatabase, type Db } from "@/db/client";
import { memberships, payments, subscriptionPrices, subscriptions, users } from "@/db/schema";

function fresh(): Db {
  const h = openDatabase(":memory:");
  runMigrations(h, "./drizzle");
  return h.db;
}
const u = (name: string, extra: Partial<typeof users.$inferInsert> = {}) => ({ username: name, displayName: name, ...extra });

describe("Schema / Migration", () => {
  it("läuft auf leerer DB durch und erzwingt Constraints", () => {
    const db = fresh();
    const [owner] = db.insert(users).values(u("anna")).returning().all();
    const [sub] = db.insert(subscriptions).values({ ownerUserId: owner!.id, name: "Netflix" }).returning().all();
    db.insert(subscriptionPrices).values({ subscriptionId: sub!.id, validFromMonth: "2026-01", amountCents: 1799 }).run();
    expect(() => db.insert(subscriptionPrices).values({ subscriptionId: sub!.id, validFromMonth: "2026-01", amountCents: 1 }).run()).toThrow();
    expect(() => db.insert(subscriptionPrices).values({ subscriptionId: sub!.id, validFromMonth: "2026-02", amountCents: -1 }).run()).toThrow();
    expect(() => db.insert(subscriptionPrices).values({ subscriptionId: sub!.id, validFromMonth: "kaputt", amountCents: 1 }).run()).toThrow();
  });

  it("Benutzername ist eindeutig, Fälligkeitstag nur 1-28", () => {
    const db = fresh();
    db.insert(users).values(u("anna")).run();
    expect(() => db.insert(users).values(u("anna")).run()).toThrow();
    expect(() => db.insert(users).values(u("bob", { dueDay: 29 })).run()).toThrow();
    expect(() => db.insert(users).values(u("cleo", { dueDay: 0 })).run()).toThrow();
    db.insert(users).values(u("dora", { dueDay: 28 })).run();
  });

  it("Zahlung: eindeutig pro Zahler/Empfänger/Monat, eindeutige Referenz-ID, nie an sich selbst", () => {
    const db = fresh();
    const [a, b, c] = db.insert(users).values([u("a"), u("b"), u("c")]).returning().all();
    const pay = (payer: number, rec: number, month: string, ref: string) =>
      db.insert(payments).values({ payerUserId: payer, recipientUserId: rec, month, referenceId: ref, amountCents: 100 }).run();
    pay(a!.id, c!.id, "2026-11", "K7M2QX");
    expect(() => pay(a!.id, c!.id, "2026-11", "ABCDEF")).toThrow();
    expect(() => pay(b!.id, c!.id, "2026-11", "K7M2QX")).toThrow();
    expect(() => pay(c!.id, c!.id, "2026-11", "ZZZZZZ")).toThrow(); // sich selbst
    pay(a!.id, b!.id, "2026-11", "ABCDEF"); // anderer Empfänger, gleicher Monat: erlaubt
    pay(a!.id, c!.id, "2026-12", "GHJKLM");
  });

  it("prüft Gewicht und Zeitraum der Mitgliedschaft; Löschen eines Abos löscht Preise und Beteiligungen", () => {
    const db = fresh();
    const [a, b] = db.insert(users).values([u("a"), u("b")]).returning().all();
    const [sub] = db.insert(subscriptions).values({ ownerUserId: a!.id, name: "X" }).returning().all();
    const m = (weight: number, from: string, to: string | null) =>
      db.insert(memberships).values({ subscriptionId: sub!.id, userId: b!.id, weight, validFromMonth: from, validToMonth: to }).run();
    m(1, "2026-01", null);
    expect(() => m(0, "2026-01", null)).toThrow();
    expect(() => m(1, "2026-05", "2026-04")).toThrow();
    db.insert(subscriptionPrices).values({ subscriptionId: sub!.id, validFromMonth: "2026-01", amountCents: 100 }).run();
    db.delete(subscriptions).run();
    expect(db.select().from(memberships).all()).toHaveLength(0);
    expect(db.select().from(subscriptionPrices).all()).toHaveLength(0);
  });

  it("ein Konto mit Abos lässt sich nicht einfach löschen", () => {
    const db = fresh();
    const [a] = db.insert(users).values(u("a")).returning().all();
    db.insert(subscriptions).values({ ownerUserId: a!.id, name: "X" }).run();
    expect(() => db.delete(users).run()).toThrow();
  });
});

describe("Verschlüsselung der Datenbankdatei", () => {
  const KEY = "k".repeat(40);
  const dir = mkdtempSync(join(tmpdir(), "enc-"));

  it("Datei enthält keinen Klartext (auch nicht in der WAL-Datei), ist ohne Schlüssel nicht lesbar und mit Schlüssel lesbar", () => {
    const path = join(dir, "a.db");
    const h = openDatabase(path, KEY);
    runMigrations(h, "./drizzle");
    h.db.insert(users).values(u("anna-geheim", { displayName: "Anna Musterfrau", iban: "DE89370400440532013000", email: "anna@example.org" })).run();
    const wal = readFileSync(`${path}-wal`);
    for (const secret of ["Anna Musterfrau", "DE89370400440532013000", "anna@example.org", "anna-geheim"]) expect(wal.includes(secret), `WAL: ${secret}`).toBe(false);
    h.sqlite.close();
    const raw = readFileSync(path);
    for (const secret of ["Anna Musterfrau", "DE89370400440532013000", "anna@example.org", "anna-geheim"]) expect(raw.includes(secret), secret).toBe(false);
    expect(isPlainSqliteFile(path)).toBe(false);
    expect(() => openDatabase(path)).toThrow(/nicht lesbar/);
    expect(() => openDatabase(path, "f".repeat(40))).toThrow(/nicht lesbar/);
    const again = openDatabase(path, KEY);
    expect(again.db.select().from(users).all()[0]?.iban).toBe("DE89370400440532013000");
    again.sqlite.close();
  });

  it("eine alte unverschlüsselte Datenbank wird nicht angefasst, sondern mit klarer Meldung abgelehnt", () => {
    const path = join(dir, "plain.db");
    const h = openDatabase(path); // Klartext
    runMigrations(h, "./drizzle");
    h.sqlite.close();
    expect(isPlainSqliteFile(path)).toBe(true);
    expect(() => initDatabase(path, "./drizzle", KEY)).toThrow(/unverschlüsselt/);
    closeDatabase();
  });
});
