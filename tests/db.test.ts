import { describe, expect, it } from "vitest";
import { openDatabase, runMigrations } from "@/db/client";
import { memberships, participants, payments, subscriptionPrices, subscriptions } from "@/db/schema";

function fresh() {
  const h = openDatabase(":memory:");
  runMigrations(h, "./drizzle");
  return h;
}

const p = (n: string, extra: Partial<typeof participants.$inferInsert> = {}) => ({
  displayName: n,
  tokenHash: `hash-${n}`,
  ...extra,
});

describe("Schema / Migration", () => {
  it("läuft auf leerer DB durch und erzwingt Constraints", () => {
    const { db } = fresh();
    const [sub] = db.insert(subscriptions).values({ name: "Netflix" }).returning().all();
    db.insert(subscriptionPrices).values({ subscriptionId: sub!.id, validFromMonth: "2026-01", amountCents: 1799 }).run();
    expect(() =>
      db.insert(subscriptionPrices).values({ subscriptionId: sub!.id, validFromMonth: "2026-01", amountCents: 1 }).run(),
    ).toThrow();
    expect(() =>
      db.insert(subscriptionPrices).values({ subscriptionId: sub!.id, validFromMonth: "2026-02", amountCents: -1 }).run(),
    ).toThrow();
  });

  it("erlaubt nur einen Owner", () => {
    const { db } = fresh();
    db.insert(participants).values(p("ich", { isOwner: true })).run();
    db.insert(participants).values(p("anna")).run();
    db.insert(participants).values(p("bob")).run();
    expect(() => db.insert(participants).values(p("zweiter", { isOwner: true })).run()).toThrow();
  });

  it("erzwingt eindeutige Referenz-ID und eine Zahlung pro Teilnehmer und Monat", () => {
    const { db } = fresh();
    const [a, b] = db.insert(participants).values([p("a"), p("b")]).returning().all();
    const pay = (pid: number, month: string, ref: string) =>
      db.insert(payments).values({ participantId: pid, month, referenceId: ref, amountCents: 100 }).run();
    pay(a!.id, "2026-11", "K7M2QX");
    expect(() => pay(a!.id, "2026-11", "ABCDEF")).toThrow();
    expect(() => pay(b!.id, "2026-11", "K7M2QX")).toThrow();
    pay(a!.id, "2026-12", "ABCDEF");
  });

  it("prüft Gewicht und Zeitraum der Mitgliedschaft", () => {
    const { db } = fresh();
    const [sub] = db.insert(subscriptions).values({ name: "X" }).returning().all();
    const [a] = db.insert(participants).values(p("a")).returning().all();
    const m = (weight: number, from: string, to: string | null) =>
      db.insert(memberships).values({ subscriptionId: sub!.id, participantId: a!.id, weight, validFromMonth: from, validToMonth: to }).run();
    m(1, "2026-01", null);
    expect(() => m(0, "2026-01", null)).toThrow();
    expect(() => m(1, "2026-05", "2026-04")).toThrow();
  });
});
