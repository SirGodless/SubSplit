import { and, eq, gte, inArray, isNull, lt, lte, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { memberships, payments, standingOrders, subscriptions, users } from "@/db/schema";
import { computeMonth, type MonthResult } from "@/lib/billing/compute";
import { addMonths, assertMonth, berlinDate, currentMonth, dueDateOf, type Month } from "@/lib/billing/month";
import { generateReferenceId } from "@/lib/billing/reference";
import { loadBillingInput } from "./billing-data";

export type PaymentStatus = "open" | "marked_paid" | "confirmed";
const MAX_CATCH_UP_MONTHS = 60;

function isReferenceCollision(err: unknown): boolean {
  return err instanceof Error && /UNIQUE constraint failed: payments\.reference_id/.test(err.message);
}

function insertPayment(db: Db, payerId: number, recipientId: number, month: Month, amountCents: number): void {
  for (let attempt = 0; attempt < 25; attempt++) {
    try {
      db.insert(payments).values({ payerUserId: payerId, recipientUserId: recipientId, month, referenceId: generateReferenceId(), amountCents }).run();
      return;
    } catch (err) {
      if (isReferenceCollision(err)) continue;
      throw err;
    }
  }
  throw new Error("Keine freie Referenz-ID gefunden");
}

/** Erster Monat, in dem bei diesem Empfänger jemand beteiligt ist (null, wenn nie). */
export function firstBillingMonth(db: Db, ownerId: number): Month | null {
  const row = db
    .select({ m: sql<string | null>`min(${memberships.validFromMonth})` })
    .from(memberships)
    .innerJoin(subscriptions, eq(subscriptions.id, memberships.subscriptionId))
    .where(eq(subscriptions.ownerUserId, ownerId))
    .get();
  return row?.m ?? null;
}

/** Berechnet einen Monat für die Abos eines Empfängers (ohne etwas zu schreiben). */
export function computeOwnerMonth(db: Db, ownerId: number, month: Month): MonthResult {
  const input = loadBillingInput(db, ownerId);
  return computeMonth(month, input.subscriptions, input.participants, ownerId);
}

/**
 * Legt für alle Zahler dieses Empfängers (nicht ihn selbst, Betrag > 0) die Monatszahlung an, falls sie fehlt.
 * Bestehende Zahlungen bleiben unverändert (Betrag ist ein Snapshot). Nur bis zum aktuellen Monat.
 */
export function ensureMonthPayments(db: Db, ownerId: number, month: Month, now: Date = new Date()): MonthResult {
  assertMonth(month);
  if (month > currentMonth(now)) throw new Error("Zukünftige Monate werden nicht abgerechnet");
  const result = computeOwnerMonth(db, ownerId, month);
  db.transaction((tx) => {
    for (const t of result.totals) {
      if (!t.payable) continue;
      const exists = tx
        .select({ id: payments.id })
        .from(payments)
        .where(and(eq(payments.payerUserId, t.participantId), eq(payments.recipientUserId, ownerId), eq(payments.month, month)))
        .get();
      if (!exists) insertPayment(tx as unknown as Db, t.participantId, ownerId, month, t.totalCents);
    }
  });
  return result;
}

/**
 * Rechnet den Monat neu und gleicht NUR offene Zahlungen an (Betrag aktualisieren, fehlende Zahlungen anlegen).
 * Als bezahlt gemeldete oder bestätigte Zahlungen bleiben unverändert (ein Unterschied wird nicht verrechnet).
 */
export function refreshOpenPayments(db: Db, ownerId: number, month: Month, now: Date = new Date()): { adjusted: number; created: number } {
  assertMonth(month);
  if (month > currentMonth(now)) throw new Error("Zukünftige Monate werden nicht abgerechnet");
  const result = computeOwnerMonth(db, ownerId, month);
  let adjusted = 0;
  let created = 0;
  db.transaction((tx) => {
    for (const t of result.totals) {
      const row = tx
        .select()
        .from(payments)
        .where(and(eq(payments.payerUserId, t.participantId), eq(payments.recipientUserId, ownerId), eq(payments.month, month)))
        .get();
      if (!row) {
        if (t.payable) {
          insertPayment(tx as unknown as Db, t.participantId, ownerId, month, t.totalCents);
          created++;
        }
      } else if (row.status === "open" && row.amountCents !== t.totalCents) {
        tx.update(payments).set({ amountCents: t.totalCents }).where(eq(payments.id, row.id)).run();
        adjusted++;
      }
    }
  });
  applyStandingOrders(db, ownerId, now);
  return { adjusted, created };
}

/**
 * Stellt sicher, dass für JEDEN Monat vom ersten Abrechnungsmonat bis jetzt die Zahlungen existieren. Nur so
 * geht ein vergessener Vormonat nicht verloren, wenn in dem Monat niemand die App geöffnet hat.
 */
export function ensureOwnerPayments(db: Db, ownerId: number, now: Date = new Date()): void {
  const first = firstBillingMonth(db, ownerId);
  const cur = currentMonth(now);
  if (first && first <= cur) {
    let m = first;
    for (let i = 0; i < MAX_CATCH_UP_MONTHS && m <= cur; i++, m = addMonths(m, 1)) ensureMonthPayments(db, ownerId, m, now);
  }
  applyStandingOrders(db, ownerId, now);
}

/**
 * Legt die Zahlungen ALLER Empfänger an und wendet Daueraufträge an. Der Planer ruft das regelmäßig auf: Zahlungen
 * entstehen sonst erst beim Aufruf der App, ohne diesen Schritt gäbe es in einem Monat ohne Besucher keine
 * Erinnerungen und keine automatische Bestätigung per Dauerauftrag.
 */
export function ensureAllOwnerPayments(db: Db, now: Date = new Date()): void {
  const owners = db.selectDistinct({ id: subscriptions.ownerUserId }).from(subscriptions).all();
  for (const o of owners) ensureOwnerPayments(db, o.id, now);
}

/**
 * Daueraufträge: Offene Zahlungen eines Zahlers mit Dauerauftrag werden ab dessen Startmonat am Fälligkeitstag des
 * Monats automatisch BESTÄTIGT (Vermerk "auto"). Frühere Monate (Rückstand vor dem Startmonat) und noch nicht fällige
 * Monate bleiben offen. Vom Empfänger zurückgesetzte Zahlungen ("skipped") werden nicht erneut automatisch bezahlt.
 */
export function applyStandingOrders(db: Db, ownerId: number, now: Date = new Date()): void {
  const orders = db.select().from(standingOrders).where(eq(standingOrders.recipientUserId, ownerId)).all();
  if (orders.length === 0) return;
  const owner = db.select({ dueDay: users.dueDay }).from(users).where(eq(users.id, ownerId)).get();
  if (!owner) return;
  const today = berlinDate(now);
  const cur = currentMonth(now);
  const ts = now.toISOString();
  for (const o of orders) {
    const rows = db
      .select()
      .from(payments)
      .where(and(eq(payments.payerUserId, o.payerUserId), eq(payments.recipientUserId, ownerId), eq(payments.status, "open"), isNull(payments.standingOrderState), gte(payments.month, o.fromMonth), lte(payments.month, cur)))
      .all();
    for (const r of rows) {
      if (dueDateOf(r.month, owner.dueDay) > today) continue; // Dauerauftrag läuft erst am Fälligkeitstag
      db.update(payments).set({ status: "confirmed", markedPaidAt: ts, confirmedAt: ts, standingOrderState: "auto" }).where(eq(payments.id, r.id)).run();
    }
  }
}

/** Erster Monat, für den sich bestehende Preise, Gewichte und Beteiligungen ändern lassen: immer der Folgemonat. */
export function nextChangeMonth(now: Date = new Date()): Month {
  return addMonths(currentMonth(now), 1);
}

/** Gibt es für diesen Empfänger im Monat schon angelegte Zahlungen (egal in welchem Status)? */
export function hasPaymentsForMonth(db: Db, ownerId: number, month: Month): boolean {
  return !!db.select({ id: payments.id }).from(payments).where(and(eq(payments.recipientUserId, ownerId), eq(payments.month, month))).get();
}

/**
 * Erster Monat, in dem ein NEUES Abo oder ein NEUER Mitzahler starten darf: der laufende Monat, solange dafür bei
 * diesem Empfänger noch keine Zahlungen angelegt wurden (sonst würden bereits berechnete Beträge nicht mehr stimmen),
 * sonst der Folgemonat.
 */
export function firstStartMonthForNew(db: Db, ownerId: number, now: Date = new Date()): Month {
  const cur = currentMonth(now);
  return hasPaymentsForMonth(db, ownerId, cur) ? addMonths(cur, 1) : cur;
}

export type PaidResult = "ok" | "not_found" | "locked";

/**
 * Zahler meldet "bezahlt" (oder nimmt es zurück) für ALLES, was er diesem Empfänger noch schuldet: den laufenden
 * Monat samt Rückstand aus Vormonaten, denn er überweist ja den Gesamtbetrag. Bestätigtes bleibt unberührt.
 */
export function setPaidByPayer(db: Db, payerId: number, recipientId: number, paid: boolean, now: Date = new Date()): PaidResult {
  const cur = currentMonth(now);
  const from: PaymentStatus = paid ? "open" : "marked_paid";
  const rows = db
    .select()
    .from(payments)
    .where(and(eq(payments.payerUserId, payerId), eq(payments.recipientUserId, recipientId), lte(payments.month, cur)))
    .all();
  if (rows.length === 0) return "not_found";
  const todo = rows.filter((r) => r.status === from);
  if (todo.length === 0) return rows.every((r) => r.status === "confirmed") || !paid ? "locked" : "ok";
  db.update(payments)
    .set(paid ? { status: "marked_paid", markedPaidAt: now.toISOString() } : { status: "open", markedPaidAt: null })
    .where(inArray(payments.id, todo.map((r) => r.id)))
    .run();
  return "ok";
}

/**
 * Empfänger setzt den Status. "Bestätigt" gilt für diese Zahlung UND alle früheren, als bezahlt gemeldeten
 * Monate desselben Zahlers (eine Überweisung deckt den Rückstand mit ab). Fremde Zahlungen -> false.
 */
export function setStatusByOwner(db: Db, ownerId: number, paymentId: number, status: PaymentStatus, now: Date = new Date()): boolean {
  const row = db.select().from(payments).where(and(eq(payments.id, paymentId), eq(payments.recipientUserId, ownerId))).get();
  if (!row) return false;
  const ts = now.toISOString();
  db.transaction((tx) => {
    tx.update(payments)
      .set({
        status,
        markedPaidAt: status === "open" ? null : (row.markedPaidAt ?? ts),
        confirmedAt: status === "confirmed" ? ts : null,
        // Vom Empfänger zurückgesetzt: nicht erneut automatisch per Dauerauftrag bestätigen
        ...(status === "open" && row.standingOrderState === "auto" ? { standingOrderState: "skipped" as const } : {}),
      })
      .where(eq(payments.id, paymentId))
      .run();
    if (status === "confirmed") {
      tx.update(payments)
        .set({ status: "confirmed", confirmedAt: ts })
        .where(and(eq(payments.payerUserId, row.payerUserId), eq(payments.recipientUserId, ownerId), lt(payments.month, row.month), eq(payments.status, "marked_paid")))
        .run();
    }
  });
  return true;
}

/** Offene (nicht gemeldete) Zahlungen eines Zahlers bei einem Empfänger bis zum aktuellen Monat, älteste zuerst. */
export function openPayments(db: Db, payerId: number, recipientId: number, now: Date = new Date()) {
  return db
    .select()
    .from(payments)
    .where(and(eq(payments.payerUserId, payerId), eq(payments.recipientUserId, recipientId), eq(payments.status, "open"), lte(payments.month, currentMonth(now))))
    .orderBy(payments.month)
    .all();
}
