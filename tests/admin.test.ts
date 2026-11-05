import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { openDatabase, runMigrations, type Db } from "@/db/client";
import { memberships, payments, subscriptionPrices, subscriptions } from "@/db/schema";
import {
  AdminError, createParticipant, createSubscription, deleteSubscription, earliestChangeMonth, endSubscription,
  reactivateSubscription, setMembership, setPrice,
} from "@/lib/services/admin";
import { ensureMonthPayments, setPaidByParticipant, setStatusByAdmin } from "@/lib/services/payments";
import { getParticipantView } from "@/lib/services/participant-view";

const NOW = new Date("2026-11-04T12:00:00Z");
const M = "2026-11";
let db: Db;
let me: number, anna: number, bob: number, netflix: number, spotify: number;

beforeEach(() => {
  const h = openDatabase(":memory:");
  runMigrations(h, "./drizzle");
  db = h.db;
  me = createParticipant(db, { displayName: "Ich", isOwner: true }).id;
  anna = createParticipant(db, { displayName: "Anna" }).id;
  bob = createParticipant(db, { displayName: "Bob" }).id;
  netflix = createSubscription(db, { name: "Netflix", priceCents: 1800, validFromMonth: M }, NOW);
  spotify = createSubscription(db, { name: "Spotify", priceCents: 900, validFromMonth: M }, NOW);
  for (const p of [anna, bob]) setMembership(db, { subscriptionId: netflix, participantId: p, weight: 1, from: M }, NOW);
  setMembership(db, { subscriptionId: spotify, participantId: anna, weight: 1, from: M }, NOW);
});

const payOf = (pid: number, month = M) => db.select().from(payments).all().find((p) => p.participantId === pid && p.month === month);

describe("Admin trägt sich selbst ein (auch nach erzeugten Zahlungen)", () => {
  it("geht im laufenden Monat, solange niemand bezahlt gemeldet hat; Beträge der anderen sinken", () => {
    ensureMonthPayments(db, M, NOW);
    expect(payOf(anna)!.amountCents).toBe(900 + 900);
    setMembership(db, { subscriptionId: netflix, participantId: me, weight: 1, from: M }, NOW);
    expect(payOf(anna)!.amountCents).toBe(600 + 900);
    expect(payOf(bob)!.amountCents).toBe(600);
    expect(payOf(me)).toBeUndefined(); // der Admin schuldet sich nichts
  });
  it("nach einer gemeldeten Zahlung ist der Monat gesperrt, ab Folgemonat geht es", () => {
    ensureMonthPayments(db, M, NOW);
    setPaidByParticipant(db, bob, M, true, NOW);
    expect(earliestChangeMonth(db, NOW)).toBe("2026-12");
    expect(() => setMembership(db, { subscriptionId: netflix, participantId: me, weight: 1, from: M }, NOW)).toThrow(/frühestens ab 2026-12/);
    setMembership(db, { subscriptionId: netflix, participantId: me, weight: 1, from: "2026-12" }, NOW);
    expect(payOf(anna)!.amountCents).toBe(1800); // eingefroren
  });
  it("earliestChangeMonth: aktueller Monat, solange alles offen ist", () => {
    expect(earliestChangeMonth(db, NOW)).toBe(M);
    ensureMonthPayments(db, M, NOW);
    expect(earliestChangeMonth(db, NOW)).toBe(M);
    const pay = payOf(anna)!;
    setStatusByAdmin(db, pay.id, "confirmed", NOW);
    expect(earliestChangeMonth(db, NOW)).toBe("2026-12");
  });
});

describe("Neuberechnung offener Zahlungen", () => {
  it("Preisänderung rechnet offene Zahlungen neu, Referenz-ID bleibt", () => {
    ensureMonthPayments(db, M, NOW);
    const ref = payOf(anna)!.referenceId;
    setPrice(db, spotify, M, 1500, NOW);
    expect(payOf(anna)!.amountCents).toBe(900 + 1500);
    expect(payOf(anna)!.referenceId).toBe(ref);
    expect(getParticipantView(db, anna, M, NOW)!.totalCents).toBe(2400);
  });
  it("wer nichts mehr schuldet, verliert die offene Zahlung; bezahlte bleiben unangetastet", () => {
    ensureMonthPayments(db, M, NOW);
    endSubscription(db, spotify, "2026-10", NOW); // wirkt ab 2026-11
    expect(payOf(anna)!.amountCents).toBe(900);
    endSubscription(db, netflix, "2026-10", NOW);
    expect(payOf(anna)).toBeUndefined();
    expect(payOf(bob)).toBeUndefined();
  });
});

describe("Abo beenden, wieder aktivieren, löschen", () => {
  it("Beenden: Beteiligungen enden, Abo ist archiviert, Änderungen daran sind gesperrt, Vergangenheit bleibt", () => {
    const dec = new Date("2026-12-02T10:00:00Z");
    ensureMonthPayments(db, M, NOW);
    setPaidByParticipant(db, anna, M, true, NOW);
    endSubscription(db, spotify, M, NOW); // letzter Monat = aktueller Monat -> wirkt ab Dezember
    const row = db.select().from(subscriptions).where(eq(subscriptions.id, spotify)).get()!;
    expect(row.archivedAt).not.toBeNull();
    expect(db.select().from(memberships).where(eq(memberships.subscriptionId, spotify)).all().every((m) => m.validToMonth === M)).toBe(true);
    expect(() => setPrice(db, spotify, "2026-12", 100, NOW)).toThrow(/beendet/);
    expect(() => setMembership(db, { subscriptionId: spotify, participantId: bob, weight: 1, from: "2026-12" }, NOW)).toThrow(/beendet/);
    // November unverändert, Dezember ohne Spotify
    expect(getParticipantView(db, anna, M, dec)!.subscriptions.map((s) => s.name).sort()).toEqual(["Netflix", "Spotify"]);
    expect(getParticipantView(db, anna, "2026-12", dec)!.subscriptions.map((s) => s.name)).toEqual(["Netflix"]);
    reactivateSubscription(db, spotify);
    setMembership(db, { subscriptionId: spotify, participantId: bob, weight: 1, from: "2026-12" }, NOW);
  });
  it("Beenden in der Vergangenheit ist nicht möglich", () => {
    expect(() => endSubscription(db, spotify, "2026-08", NOW)).toThrow(AdminError);
  });
  it("Löschen: erlaubt, solange nichts bezahlt gemeldet ist; entfernt Preise und Beteiligungen und rechnet neu", () => {
    ensureMonthPayments(db, M, NOW);
    expect(payOf(anna)!.amountCents).toBe(1800);
    deleteSubscription(db, spotify, NOW);
    expect(db.select().from(subscriptions).where(eq(subscriptions.id, spotify)).all()).toHaveLength(0);
    expect(db.select().from(subscriptionPrices).where(eq(subscriptionPrices.subscriptionId, spotify)).all()).toHaveLength(0);
    expect(db.select().from(memberships).where(eq(memberships.subscriptionId, spotify)).all()).toHaveLength(0);
    expect(payOf(anna)!.amountCents).toBe(900);
  });
  it("Löschen ist gesperrt, wenn schon bezahlt gemeldet wurde, oder das Abo in einem vergangenen Monat abgerechnet wurde", () => {
    ensureMonthPayments(db, M, NOW);
    setPaidByParticipant(db, anna, M, true, NOW);
    expect(() => deleteSubscription(db, spotify, NOW)).toThrow(/stattdessen beenden/);
    const dec = new Date("2026-12-02T10:00:00Z");
    // Anna hat im November nichts bestätigt, aber der November ist jetzt Vergangenheit und abgerechnet
    expect(() => deleteSubscription(db, netflix, dec)).toThrow(/abgerechnet/);
  });
  it("Löschen eines nie abgerechneten Abos klappt auch mit Startmonat in der Zukunft", () => {
    const later = createSubscription(db, { name: "Später", priceCents: 500, validFromMonth: "2027-01" }, NOW);
    deleteSubscription(db, later, NOW);
    expect(db.select().from(subscriptions).where(eq(subscriptions.id, later)).all()).toHaveLength(0);
  });
  it("unbekanntes Abo -> not_found", () => {
    expect(() => deleteSubscription(db, 9999, NOW)).toThrow(/nicht gefunden/);
    expect(() => endSubscription(db, 9999, M, NOW)).toThrow(/nicht gefunden/);
    expect(() => reactivateSubscription(db, 9999)).toThrow(/nicht gefunden/);
  });
});
