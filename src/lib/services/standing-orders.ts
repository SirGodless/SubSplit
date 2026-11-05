import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { memberships, payments, standingOrders, subscriptions } from "@/db/schema";
import { assertMonth, currentMonth, type Month } from "@/lib/billing/month";
import { AppError } from "./errors";
import { ensureOwnerPayments } from "./payments";

/** Besteht zwischen Zahler und Empfänger eine Beziehung (Beteiligung an einem Abo, Zahlung oder Dauerauftrag)? */
function hasRelation(db: Db, payerId: number, recipientId: number): boolean {
  return !!(
    db.select({ id: memberships.id }).from(memberships).innerJoin(subscriptions, eq(subscriptions.id, memberships.subscriptionId))
      .where(and(eq(memberships.userId, payerId), eq(subscriptions.ownerUserId, recipientId))).get() ??
    db.select({ id: payments.id }).from(payments).where(and(eq(payments.payerUserId, payerId), eq(payments.recipientUserId, recipientId))).get() ??
    db.select({ id: standingOrders.id }).from(standingOrders).where(and(eq(standingOrders.payerUserId, payerId), eq(standingOrders.recipientUserId, recipientId))).get()
  );
}

export function getStandingOrder(db: Db, payerId: number, recipientId: number): { fromMonth: Month } | null {
  const o = db.select({ fromMonth: standingOrders.fromMonth }).from(standingOrders).where(and(eq(standingOrders.payerUserId, payerId), eq(standingOrders.recipientUserId, recipientId))).get();
  return o ?? null;
}

/**
 * Dauerauftrag ein- oder ausschalten. Beide Seiten dürfen das (Zahler oder Empfänger, Vertrauensbasis), niemand sonst.
 * `fromMonth: null` schaltet aus (bereits automatisch bestätigte Monate bleiben bestätigt). Sonst gilt er ab dem laufenden
 * Monat oder später. Gilt sofort für schon fällige Monate ab dem Startmonat.
 */
export function setStandingOrder(
  db: Db,
  actorId: number,
  input: { payerUserId: number; recipientUserId: number; fromMonth: Month | null },
  now: Date = new Date(),
): void {
  const { payerUserId, recipientUserId, fromMonth } = input;
  if (payerUserId === recipientUserId || (actorId !== payerUserId && actorId !== recipientUserId) || !hasRelation(db, payerUserId, recipientUserId))
    throw new AppError("not_found", "Nicht gefunden.");
  if (fromMonth === null) {
    db.delete(standingOrders).where(and(eq(standingOrders.payerUserId, payerUserId), eq(standingOrders.recipientUserId, recipientUserId))).run();
    return;
  }
  assertMonth(fromMonth);
  if (fromMonth < currentMonth(now)) throw new AppError("invalid", "Der Dauerauftrag gilt ab dem laufenden Monat oder später.");
  db.insert(standingOrders)
    .values({ payerUserId, recipientUserId, fromMonth, createdByUserId: actorId })
    .onConflictDoUpdate({ target: [standingOrders.payerUserId, standingOrders.recipientUserId], set: { fromMonth, createdByUserId: actorId } })
    .run();
  ensureOwnerPayments(db, recipientUserId, now); // legt Zahlungen an und wendet den Dauerauftrag sofort an
}
