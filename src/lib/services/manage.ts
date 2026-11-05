import { and, eq, gt, gte, lt, ne, or, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { memberships, payments, subscriptionPrices, subscriptions, users } from "@/db/schema";
import { addMonths, assertMonth, currentMonth, type Month } from "@/lib/billing/month";
import { AppError } from "./errors";
import { earliestChangeMonth, reconcileOpenPayments } from "./payments";
import { assertCanOwnSubscriptions } from "./users";

export { earliestChangeMonth };

/**
 * Änderungen an Preis/Gewicht/Beteiligung gelten ab Monat M. Erlaubt ab dem aktuellen Monat, solange bei diesem
 * Empfänger keine Zahlung des Monats als bezahlt gemeldet oder bestätigt ist; offene Zahlungen werden danach neu
 * berechnet (Referenz-ID bleibt). Vergangene Monate sind fest.
 */
export function assertChangeAllowed(db: Db, ownerId: number, effectiveFrom: Month, now: Date = new Date()): void {
  assertMonth(effectiveFrom);
  if (effectiveFrom < currentMonth(now)) throw new AppError("not_allowed", "Änderungen wirken nur ab dem aktuellen Monat.");
  const earliest = earliestChangeMonth(db, ownerId, now);
  if (effectiveFrom < earliest)
    throw new AppError("not_allowed", `Für ${effectiveFrom} gibt es bereits als bezahlt gemeldete oder bestätigte Zahlungen – Änderung frühestens ab ${earliest}.`);
}

/** Das Abo, falls es diesem Empfänger gehört. Fremde und unbekannte Abos sehen gleich aus (not_found). */
export function ownedSubscription(db: Db, ownerId: number, subscriptionId: number) {
  const s = db.select().from(subscriptions).where(and(eq(subscriptions.id, subscriptionId), eq(subscriptions.ownerUserId, ownerId))).get();
  if (!s) throw new AppError("not_found", "Abo nicht gefunden.");
  return s;
}

function assertActive(sub: { archivedAt: string | null }): void {
  if (sub.archivedAt) throw new AppError("invalid", "Das Abo ist beendet. Bitte zuerst wieder aktivieren.");
}

const validCents = (c: number) => Number.isSafeInteger(c) && c >= 0 && c <= 10_000_000;
const validWeight = (w: number) => Number.isSafeInteger(w) && w >= 1 && w <= 1000;

function cleanName(name: string): string {
  const v = name.trim();
  if (!v || v.length > 60) throw new AppError("invalid", "Abo-Name muss 1-60 Zeichen lang sein.");
  return v;
}

// ---------- Abos & Preise ----------

export function createSubscription(db: Db, ownerId: number, input: { name: string; priceCents: number; validFromMonth: Month }, now = new Date()): number {
  const name = cleanName(input.name);
  if (!validCents(input.priceCents)) throw new AppError("invalid", "Ungültiger Preis.");
  assertCanOwnSubscriptions(db, ownerId);
  assertChangeAllowed(db, ownerId, input.validFromMonth, now);
  return db.transaction((tx) => {
    const s = tx.insert(subscriptions).values({ ownerUserId: ownerId, name }).returning({ id: subscriptions.id }).get();
    tx.insert(subscriptionPrices).values({ subscriptionId: s.id, validFromMonth: input.validFromMonth, amountCents: input.priceCents }).run();
    return s.id;
  });
}

export function renameSubscription(db: Db, ownerId: number, id: number, name: string): void {
  ownedSubscription(db, ownerId, id);
  db.update(subscriptions).set({ name: cleanName(name) }).where(eq(subscriptions.id, id)).run();
}

/** Neuer Preis ab Monat; ersetzt einen vorhandenen Eintrag desselben Monats. Spätere Einträge bleiben bestehen. */
export function setPrice(db: Db, ownerId: number, subscriptionId: number, validFromMonth: Month, priceCents: number, now = new Date()): void {
  if (!validCents(priceCents)) throw new AppError("invalid", "Ungültiger Preis.");
  const sub = ownedSubscription(db, ownerId, subscriptionId);
  assertActive(sub);
  assertChangeAllowed(db, ownerId, validFromMonth, now);
  db.transaction((tx) => {
    tx.insert(subscriptionPrices)
      .values({ subscriptionId, validFromMonth, amountCents: priceCents })
      .onConflictDoUpdate({ target: [subscriptionPrices.subscriptionId, subscriptionPrices.validFromMonth], set: { amountCents: priceCents } })
      .run();
    reconcileOpenPayments(tx as unknown as Db, ownerId, validFromMonth, now);
  });
}

// ---------- Beteiligungen ----------

/** Schneidet bestehende Beteiligungen so zu, dass ab `from` nichts mehr überlappt. */
function clearFrom(tx: Db, subscriptionId: number, userId: number, from: Month): void {
  const same = and(eq(memberships.subscriptionId, subscriptionId), eq(memberships.userId, userId));
  tx.delete(memberships).where(and(same, gte(memberships.validFromMonth, from))).run();
  tx.update(memberships)
    .set({ validToMonth: addMonths(from, -1) })
    .where(and(same, lt(memberships.validFromMonth, from), or(isNull(memberships.validToMonth), gte(memberships.validToMonth, from))))
    .run();
}

function assertUserSelectable(db: Db, userId: number): void {
  const u = db.select({ disabledAt: users.disabledAt }).from(users).where(eq(users.id, userId)).get();
  if (!u || u.disabledAt) throw new AppError("not_found", "Konto nicht gefunden.");
}

/** Beteiligung bzw. neues Gewicht ab Monat `from` (unbefristet). `userId` kann jedes aktive Konto sein. */
export function setMembership(db: Db, ownerId: number, input: { subscriptionId: number; userId: number; weight: number; from: Month }, now = new Date()): void {
  if (!validWeight(input.weight)) throw new AppError("invalid", "Gewicht muss eine ganze Zahl von 1 bis 1000 sein.");
  const sub = ownedSubscription(db, ownerId, input.subscriptionId);
  assertActive(sub);
  assertChangeAllowed(db, ownerId, input.from, now);
  assertUserSelectable(db, input.userId);
  db.transaction((tx) => {
    clearFrom(tx as unknown as Db, input.subscriptionId, input.userId, input.from);
    tx.insert(memberships).values({ subscriptionId: input.subscriptionId, userId: input.userId, weight: input.weight, validFromMonth: input.from }).run();
    reconcileOpenPayments(tx as unknown as Db, ownerId, input.from, now);
  });
}

/** Kern des Beendens (auch für das Austragen durch den Teilnehmer): endet nach `lastMonth`, wirkt also ab dem Folgemonat. */
export function endMembershipFrom(db: Db, ownerId: number, subscriptionId: number, userId: number, lastMonth: Month, now = new Date()): void {
  assertMonth(lastMonth);
  const from = addMonths(lastMonth, 1);
  assertChangeAllowed(db, ownerId, from, now);
  db.transaction((tx) => {
    clearFrom(tx as unknown as Db, subscriptionId, userId, from);
    reconcileOpenPayments(tx as unknown as Db, ownerId, from, now);
  });
}

export function endMembership(db: Db, ownerId: number, input: { subscriptionId: number; userId: number; lastMonth: Month }, now = new Date()): void {
  ownedSubscription(db, ownerId, input.subscriptionId);
  endMembershipFrom(db, ownerId, input.subscriptionId, input.userId, input.lastMonth, now);
}

// ---------- Abo beenden / wieder aktivieren / löschen ----------

/** Beendet das Abo nach `lastMonth`: alle Beteiligungen enden, das Abo wird archiviert. Vergangene Monate bleiben unverändert. */
export function endSubscription(db: Db, ownerId: number, id: number, lastMonth: Month, now = new Date()): void {
  assertMonth(lastMonth);
  ownedSubscription(db, ownerId, id);
  const from = addMonths(lastMonth, 1);
  assertChangeAllowed(db, ownerId, from, now);
  db.transaction((tx) => {
    tx.delete(memberships).where(and(eq(memberships.subscriptionId, id), gt(memberships.validFromMonth, lastMonth))).run();
    tx.update(memberships)
      .set({ validToMonth: lastMonth })
      .where(and(eq(memberships.subscriptionId, id), or(isNull(memberships.validToMonth), gt(memberships.validToMonth, lastMonth))))
      .run();
    tx.update(subscriptions).set({ archivedAt: now.toISOString() }).where(eq(subscriptions.id, id)).run();
    reconcileOpenPayments(tx as unknown as Db, ownerId, from, now);
  });
}

export function reactivateSubscription(db: Db, ownerId: number, id: number): void {
  ownedSubscription(db, ownerId, id);
  db.update(subscriptions).set({ archivedAt: null }).where(eq(subscriptions.id, id)).run();
}

/**
 * Endgültig löschen (mit Preisen und Beteiligungen). Nur, solange das Abo in keiner abgelaufenen oder bezahlt
 * gemeldeten Abrechnung vorkommen kann; sonst stattdessen beenden.
 */
export function deleteSubscription(db: Db, ownerId: number, id: number, now = new Date()): void {
  ownedSubscription(db, ownerId, id);
  const months = [
    ...db.select({ m: subscriptionPrices.validFromMonth }).from(subscriptionPrices).where(eq(subscriptionPrices.subscriptionId, id)).all().map((r) => r.m),
    ...db.select({ m: memberships.validFromMonth }).from(memberships).where(eq(memberships.subscriptionId, id)).all().map((r) => r.m),
  ].sort();
  const first = months[0];
  const cur = currentMonth(now);
  if (first !== undefined) {
    const blocking = db
      .select({ c: sql<number>`count(*)` })
      .from(payments)
      .where(and(eq(payments.recipientUserId, ownerId), gte(payments.month, first), or(lt(payments.month, cur), ne(payments.status, "open"))))
      .get();
    if ((blocking?.c ?? 0) > 0) throw new AppError("not_allowed", "Das Abo wurde bereits abgerechnet und kann nicht mehr gelöscht werden. Bitte stattdessen beenden.");
  }
  db.transaction((tx) => {
    tx.delete(subscriptions).where(eq(subscriptions.id, id)).run();
    reconcileOpenPayments(tx as unknown as Db, ownerId, cur, now);
  });
}
