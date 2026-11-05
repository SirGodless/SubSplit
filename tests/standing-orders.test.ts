import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { openDatabase, runMigrations, type Db } from "@/db/client";
import { memberships, payments, standingOrders, subscriptionPrices, subscriptions } from "@/db/schema";
import { AppError } from "@/lib/services/errors";
import { createSubscription, setMembership } from "@/lib/services/manage";
import { ensureOwnerPayments, setPaidByPayer, setStatusByOwner } from "@/lib/services/payments";
import { getStandingOrder, setStandingOrder } from "@/lib/services/standing-orders";
import { createUser, updateRecipient } from "@/lib/services/users";
import { getHome, getOwnerOverview, getPayerView } from "@/lib/services/views";

const NOW = new Date("2026-11-04T12:00:00Z"); // 4. November 2026; Fälligkeitstag 1. ist schon vorbei
const M = "2026-11";
const DEC = "2026-12";
let db: Db;
let boss: number, other: number, anna: number, bob: number, cleo: number, netflix: number;

const mk = (name: string, recipient = false) => {
  const id = createUser(db, { username: name, displayName: name[0]!.toUpperCase() + name.slice(1) });
  if (recipient) updateRecipient(db, id, { iban: "GB82 WEST 1234 5698 7654 32" });
  return id;
};
const pay = (payer: number, recipient: number, month = M) => db.select().from(payments).all().find((p) => p.payerUserId === payer && p.recipientUserId === recipient && p.month === month);
const on = (actor: number, payer: number, recipient: number, fromMonth: string | null, now = NOW) => setStandingOrder(db, actor, { payerUserId: payer, recipientUserId: recipient, fromMonth }, now);

beforeEach(() => {
  const h = openDatabase(":memory:");
  runMigrations(h, "./drizzle");
  db = h.db;
  boss = mk("boss", true); other = mk("other", true);
  anna = mk("anna"); bob = mk("bob"); cleo = mk("cleo");
  netflix = createSubscription(db, boss, { name: "Netflix", priceCents: 1800, validFromMonth: M }, NOW);
  setMembership(db, boss, { subscriptionId: netflix, userId: anna, weight: 1, from: M }, NOW);
  setMembership(db, boss, { subscriptionId: netflix, userId: bob, weight: 1, from: M }, NOW);
});

describe("Wer den Dauerauftrag setzen darf", () => {
  it("der Zahler selbst und der Empfänger, sonst niemand", () => {
    on(anna, anna, boss, M);
    expect(getStandingOrder(db, anna, boss)).toEqual({ fromMonth: M });
    on(boss, bob, boss, M);
    expect(getStandingOrder(db, bob, boss)).toEqual({ fromMonth: M });
    // Dritte (auch andere Empfänger) bekommen nichts zu sehen und nichts zu ändern
    expect(() => on(cleo, anna, boss, null)).toThrow(AppError);
    expect(() => on(other, anna, boss, null)).toThrow(AppError);
    expect(getStandingOrder(db, anna, boss)).toEqual({ fromMonth: M });
  });
  it("nur bei bestehender Beziehung, nie mit sich selbst, nie für vergangene Monate", () => {
    expect(() => on(cleo, cleo, boss, M)).toThrow(/Nicht gefunden/); // Cleo hat bei Boss kein Abo
    expect(() => on(boss, boss, boss, M)).toThrow(AppError);
    expect(() => on(anna, anna, boss, "2026-10")).toThrow(/laufenden Monat oder später/);
    expect(() => on(anna, anna, boss, "kaputt")).toThrow(/Ungültiger Monat/);
  });
  it("ausschalten mit null; erneutes Einschalten ersetzt den Startmonat", () => {
    on(anna, anna, boss, M);
    on(anna, anna, boss, DEC);
    expect(getStandingOrder(db, anna, boss)).toEqual({ fromMonth: DEC });
    on(boss, anna, boss, null);
    expect(getStandingOrder(db, anna, boss)).toBeNull();
    expect(db.select().from(standingOrders).all()).toHaveLength(0);
  });
});

describe("Wirkung: am Fälligkeitstag automatisch bestätigt", () => {
  it("ist der Fälligkeitstag schon vorbei, gilt der laufende Monat sofort als bestätigt (per Dauerauftrag)", () => {
    on(anna, anna, boss, M);
    expect(pay(anna, boss)).toMatchObject({ status: "confirmed", standingOrderState: "auto" });
    expect(pay(anna, boss)!.confirmedAt).not.toBeNull();
    expect(pay(bob, boss)!.status).toBe("open"); // nur wer einen Dauerauftrag hat
  });
  it("vor dem Fälligkeitstag bleibt die Zahlung offen und wird erst an diesem Tag bestätigt", () => {
    updateRecipient(db, boss, { dueDay: 10 });
    on(anna, anna, boss, M);
    expect(pay(anna, boss)!.status).toBe("open");
    ensureOwnerPayments(db, boss, new Date("2026-11-09T12:00:00Z"));
    expect(pay(anna, boss)!.status).toBe("open");
    ensureOwnerPayments(db, boss, new Date("2026-11-10T12:00:00Z")); // Fälligkeitstag selbst
    expect(pay(anna, boss)).toMatchObject({ status: "confirmed", standingOrderState: "auto" });
  });
  it("Startmonat in der Zukunft: der laufende Monat bleibt offen, der Folgemonat wird am Fälligkeitstag bestätigt", () => {
    on(anna, anna, boss, DEC);
    expect(pay(anna, boss)!.status).toBe("open");
    ensureOwnerPayments(db, boss, new Date("2026-12-02T10:00:00Z"));
    expect(pay(anna, boss, DEC)).toMatchObject({ status: "confirmed", standingOrderState: "auto" });
    expect(pay(anna, boss)!.status).toBe("open"); // November vor dem Startmonat bleibt offen
  });
  it("Rückstand vor dem Startmonat wird nicht automatisch bezahlt", () => {
    // ein zusätzliches Abo, in dem Anna schon seit Oktober allein dabei ist
    const old = db.insert(subscriptions).values({ ownerUserId: boss, name: "Alt" }).returning().get();
    db.insert(subscriptionPrices).values({ subscriptionId: old.id, validFromMonth: "2026-10", amountCents: 1000 }).run();
    db.insert(memberships).values({ subscriptionId: old.id, userId: anna, weight: 1, validFromMonth: "2026-10" }).run();
    ensureOwnerPayments(db, boss, NOW);
    expect(pay(anna, boss, "2026-10")).toMatchObject({ status: "open", amountCents: 1000 });
    on(anna, anna, boss, M);
    expect(pay(anna, boss, "2026-10")!.status).toBe("open"); // Oktober: Rückstand, bleibt offen
    expect(pay(anna, boss, M)).toMatchObject({ status: "confirmed", standingOrderState: "auto" });
    expect(getHome(db, anna, NOW)!.totalOutstandingCents).toBe(1000);
  });
  it("ausschalten: spätere Monate laufen wieder normal, bereits automatisch bezahlte bleiben bezahlt", () => {
    on(anna, anna, boss, M);
    on(anna, anna, boss, null);
    expect(pay(anna, boss, M)!.status).toBe("confirmed");
    ensureOwnerPayments(db, boss, new Date("2026-12-02T10:00:00Z"));
    expect(pay(anna, boss, DEC)).toMatchObject({ status: "open", standingOrderState: null });
  });
  it("Zurücksetzen durch den Empfänger wird nicht erneut automatisch überschrieben; andere Monate laufen weiter", () => {
    on(anna, anna, boss, M);
    const id = pay(anna, boss)!.id;
    setStatusByOwner(db, boss, id, "open", NOW);
    expect(pay(anna, boss)).toMatchObject({ status: "open", standingOrderState: "skipped", confirmedAt: null });
    ensureOwnerPayments(db, boss, NOW);
    expect(pay(anna, boss)!.status).toBe("open");
    ensureOwnerPayments(db, boss, new Date("2026-12-02T10:00:00Z"));
    expect(pay(anna, boss, DEC)!.status).toBe("confirmed"); // Dezember wieder automatisch
  });
  it("ein Dauerauftrag bei einem Empfänger betrifft nie einen anderen", () => {
    const sub2 = createSubscription(db, other, { name: "Cloud", priceCents: 1000, validFromMonth: M }, NOW);
    setMembership(db, other, { subscriptionId: sub2, userId: anna, weight: 1, from: M }, NOW);
    on(anna, anna, boss, M);
    ensureOwnerPayments(db, other, NOW);
    expect(pay(anna, other)!.status).toBe("open");
  });
});

describe("Anzeige", () => {
  it("Startseite und Zahlungsansicht: vom Dauerauftrag abgedeckte Beträge sind nichts zu Überweisendes", () => {
    updateRecipient(db, boss, { dueDay: 10 }); // vor dem Fälligkeitstag bleibt die Zahlung offen, ist aber abgedeckt
    on(anna, anna, boss, M);
    const home = getHome(db, anna, NOW)!;
    expect(home.totalOutstandingCents).toBe(0);
    expect(home.payments[0]).toMatchObject({ recipientId: boss, outstandingCents: 0, expectedCents: 900, standingOrder: true });
    const v = getPayerView(db, anna, boss, M, NOW)!;
    expect(v.standingOrder).toEqual({ fromMonth: M });
    expect(v.outstanding.totalCents).toBe(0);
    expect(v.outstanding.referenceId).toBeNull();
    expect(v.expected).toEqual({ totalCents: 900, items: [{ month: M, amountCents: 900 }] });
    // Bob ohne Dauerauftrag schuldet normal
    expect(getHome(db, bob, NOW)!.totalOutstandingCents).toBe(900);
    expect(getPayerView(db, bob, boss, M, NOW)!.standingOrder).toBeNull();
  });
  it("Empfänger-Übersicht: Dauerauftrag und automatische Bestätigung pro Zahler sichtbar, zählt als bestätigt", () => {
    on(boss, anna, boss, M);
    const ov = getOwnerOverview(db, boss, M, NOW);
    const a = ov.payments.find((p) => p.payerName === "Anna")!;
    const b = ov.payments.find((p) => p.payerName === "Bob")!;
    expect(a).toMatchObject({ status: "confirmed", standingOrder: M, viaStandingOrder: true });
    expect(b).toMatchObject({ status: "open", standingOrder: null, viaStandingOrder: false });
    expect(ov.totals.confirmedCents).toBe(900);
    expect(ov.totals.openCents).toBe(900);
  });
  it("nur die beiden Beteiligten sehen den Dauerauftrag: ein Dritter bekommt keine Ansicht", () => {
    on(anna, anna, boss, M);
    expect(getPayerView(db, cleo, boss, M, NOW)).toBeNull();
    expect(JSON.stringify(getHome(db, bob, NOW))).not.toMatch(/standingOrder":true/);
  });
  it("'Ich habe bezahlt' ist beim Dauerauftrag nicht nötig, ein Melden bleibt trotzdem unschädlich", () => {
    on(anna, anna, boss, M);
    expect(setPaidByPayer(db, anna, boss, true, NOW)).toBe("locked"); // alles schon bestätigt
  });
});
