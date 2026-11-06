import { and, eq, gt, gte, lt, or, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { memberships, payments, subscriptionPrices, subscriptions, users } from "@/db/schema";
import { addMonths, assertMonth, currentMonth, type Month } from "@/lib/billing/month";
import { AppError } from "./errors";
import { firstStartMonthForNew, nextChangeMonth, refreshOpenPayments } from "./payments";
import { assertCanOwnSubscriptions } from "./users";

/**
 * Regeln für Änderungen (Empfänger-Seite): Der laufende Monat ist fest.
 *  - Bestehendes (Preis, Gewicht, Beteiligung beenden, Abo beenden) gilt erst ab dem Folgemonat.
 *  - NEUE Abos und NEUE Mitzahler dürfen im laufenden Monat starten, solange dafür bei diesem Empfänger noch keine
 *    Zahlungen angelegt wurden; sonst ebenfalls ab dem Folgemonat.
 */
export function assertExistingChange(effectiveFrom: Month, now: Date = new Date()): void {
  assertMonth(effectiveFrom);
  const min = nextChangeMonth(now);
  if (effectiveFrom < min) throw new AppError("not_allowed", `Änderungen an Bestehendem gelten erst ab dem Folgemonat (${min}). Der laufende Monat bleibt fest.`);
}

export function assertNewStart(db: Db, ownerId: number, effectiveFrom: Month, now: Date = new Date()): void {
  assertMonth(effectiveFrom);
  const min = firstStartMonthForNew(db, ownerId, now);
  if (effectiveFrom < min)
    throw new AppError("not_allowed", `Neue Abos und neue Mitzahler starten frühestens ab ${min}${min > currentMonth(now) ? " (für den laufenden Monat sind schon Zahlungen angelegt)" : ""}.`);
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
  assertNewStart(db, ownerId, input.validFromMonth, now);
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

/** Neuer Preis ab Monat (frühestens Folgemonat); ersetzt einen vorhandenen Eintrag desselben Monats. */
export function setPrice(db: Db, ownerId: number, subscriptionId: number, validFromMonth: Month, priceCents: number, now = new Date()): void {
  if (!validCents(priceCents)) throw new AppError("invalid", "Ungültiger Preis.");
  const sub = ownedSubscription(db, ownerId, subscriptionId);
  assertActive(sub);
  assertExistingChange(validFromMonth, now);
  db.insert(subscriptionPrices)
    .values({ subscriptionId, validFromMonth, amountCents: priceCents })
    .onConflictDoUpdate({ target: [subscriptionPrices.subscriptionId, subscriptionPrices.validFromMonth], set: { amountCents: priceCents } })
    .run();
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

/**
 * Beteiligung bzw. neues Gewicht ab Monat `from` (unbefristet). Ist das Konto gerade schon Mitzahler, ist das eine
 * Änderung (frühestens Folgemonat); sonst ein neuer Mitzahler (siehe assertNewStart).
 */
export function setMembership(db: Db, ownerId: number, input: { subscriptionId: number; userId: number; weight: number; from: Month }, now = new Date()): void {
  if (!validWeight(input.weight)) throw new AppError("invalid", "Gewicht muss eine ganze Zahl von 1 bis 1000 sein.");
  const sub = ownedSubscription(db, ownerId, input.subscriptionId);
  assertActive(sub);
  assertUserSelectable(db, input.userId);
  const cur = currentMonth(now);
  const activeNow = db
    .select({ id: memberships.id })
    .from(memberships)
    .where(and(eq(memberships.subscriptionId, input.subscriptionId), eq(memberships.userId, input.userId), coversMonth(cur)))
    .get();
  if (activeNow) assertExistingChange(input.from, now);
  else assertNewStart(db, ownerId, input.from, now);
  db.transaction((tx) => {
    clearFrom(tx as unknown as Db, input.subscriptionId, input.userId, input.from);
    tx.insert(memberships).values({ subscriptionId: input.subscriptionId, userId: input.userId, weight: input.weight, validFromMonth: input.from }).run();
  });
}

/**
 * Zieht neu eingetragene Mitzahler, die erst ab dem Folgemonat starten würden (weil für den laufenden Monat schon
 * Zahlungen angelegt sind), in den laufenden Monat vor. Nur Zahler, die im laufenden Monat bei diesem Abo noch nicht
 * beteiligt sind (keine Gewichtsänderungen) und nur bei aktiven Abos mit einem Preis für den laufenden Monat.
 * Danach werden die offenen Zahlungen aller neu berechnet; bereits gemeldete/bestätigte bleiben unverändert.
 */
export function includeNewMembersInCurrentMonth(db: Db, ownerId: number, now = new Date()): { members: number; adjusted: number; created: number } {
  const cur = currentMonth(now);
  const next = addMonths(cur, 1);
  const subs = db.select().from(subscriptions).where(and(eq(subscriptions.ownerUserId, ownerId), isNull(subscriptions.archivedAt))).all();
  let members = 0;
  db.transaction((tx) => {
    for (const sub of subs) {
      const hasPriceNow = tx
        .select({ id: subscriptionPrices.id })
        .from(subscriptionPrices)
        .where(and(eq(subscriptionPrices.subscriptionId, sub.id), sql`${subscriptionPrices.validFromMonth} <= ${cur}`))
        .get();
      if (!hasPriceNow) continue;
      const rows = tx.select().from(memberships).where(and(eq(memberships.subscriptionId, sub.id), eq(memberships.validFromMonth, next))).all();
      for (const r of rows) {
        const activeNow = tx
          .select({ id: memberships.id })
          .from(memberships)
          .where(and(eq(memberships.subscriptionId, sub.id), eq(memberships.userId, r.userId), coversMonth(cur)))
          .get();
        if (activeNow) continue;
        tx.update(memberships).set({ validFromMonth: cur }).where(eq(memberships.id, r.id)).run();
        members++;
      }
    }
  });
  if (members === 0) return { members: 0, adjusted: 0, created: 0 };
  const res = refreshOpenPayments(db, ownerId, cur, now);
  return { members, ...res };
}

/** Bedingung "Beteiligung deckt den Monat ab". */
function coversMonth(month: Month) {
  return and(sql`${memberships.validFromMonth} <= ${month}`, or(isNull(memberships.validToMonth), sql`${memberships.validToMonth} >= ${month}`));
}

/** Kern des Beendens (auch für das Austragen durch den Teilnehmer): endet nach `lastMonth`, wirkt also ab dem Folgemonat. */
export function endMembershipFrom(db: Db, subscriptionId: number, userId: number, lastMonth: Month, now = new Date()): void {
  assertMonth(lastMonth);
  assertExistingChange(addMonths(lastMonth, 1), now);
  db.transaction((tx) => clearFrom(tx as unknown as Db, subscriptionId, userId, addMonths(lastMonth, 1)));
}

export function endMembership(db: Db, ownerId: number, input: { subscriptionId: number; userId: number; lastMonth: Month }, now = new Date()): void {
  ownedSubscription(db, ownerId, input.subscriptionId);
  endMembershipFrom(db, input.subscriptionId, input.userId, input.lastMonth, now);
}

// ---------- Abo beenden / wieder aktivieren / löschen ----------

/** Beendet das Abo nach `lastMonth` (frühestens der laufende Monat): Beteiligungen enden, das Abo wird archiviert. */
export function endSubscription(db: Db, ownerId: number, id: number, lastMonth: Month, now = new Date()): void {
  assertMonth(lastMonth);
  ownedSubscription(db, ownerId, id);
  assertExistingChange(addMonths(lastMonth, 1), now);
  db.transaction((tx) => {
    tx.delete(memberships).where(and(eq(memberships.subscriptionId, id), gt(memberships.validFromMonth, lastMonth))).run();
    tx.update(memberships)
      .set({ validToMonth: lastMonth })
      .where(and(eq(memberships.subscriptionId, id), or(isNull(memberships.validToMonth), gt(memberships.validToMonth, lastMonth))))
      .run();
    tx.update(subscriptions).set({ archivedAt: now.toISOString() }).where(eq(subscriptions.id, id)).run();
  });
}

export function reactivateSubscription(db: Db, ownerId: number, id: number): void {
  ownedSubscription(db, ownerId, id);
  db.update(subscriptions).set({ archivedAt: null }).where(eq(subscriptions.id, id)).run();
}

/**
 * Endgültig löschen (mit Preisen und Beteiligungen). Nur, solange für dieses Abo noch keine Zahlungen angelegt wurden
 * (kein Zahlungsdatensatz dieses Empfängers ab dem ersten Monat des Abos); sonst stattdessen beenden.
 */
export function deleteSubscription(db: Db, ownerId: number, id: number): void {
  ownedSubscription(db, ownerId, id);
  const months = [
    ...db.select({ m: subscriptionPrices.validFromMonth }).from(subscriptionPrices).where(eq(subscriptionPrices.subscriptionId, id)).all().map((r) => r.m),
    ...db.select({ m: memberships.validFromMonth }).from(memberships).where(eq(memberships.subscriptionId, id)).all().map((r) => r.m),
  ].sort();
  const first = months[0];
  if (first !== undefined) {
    const billed = db.select({ c: sql<number>`count(*)` }).from(payments).where(and(eq(payments.recipientUserId, ownerId), gte(payments.month, first))).get();
    if ((billed?.c ?? 0) > 0) throw new AppError("not_allowed", "Für das Abo wurden schon Zahlungen angelegt und es kann nicht mehr gelöscht werden. Bitte stattdessen beenden.");
  }
  db.delete(subscriptions).where(eq(subscriptions.id, id)).run();
}
