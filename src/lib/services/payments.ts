import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { payments } from "@/db/schema";
import { computeMonth, type MonthResult } from "@/lib/billing/compute";
import { currentMonth, assertMonth, type Month } from "@/lib/billing/month";
import { generateReferenceId } from "@/lib/billing/reference";
import { loadBillingInput } from "./billing-data";

export type PaymentStatus = "open" | "marked_paid" | "confirmed";

function isReferenceCollision(err: unknown): boolean {
  return err instanceof Error && /UNIQUE constraint failed: payments\.reference_id/.test(err.message);
}

function insertPayment(db: Db, participantId: number, month: Month, amountCents: number): void {
  for (let attempt = 0; attempt < 25; attempt++) {
    try {
      db.insert(payments).values({ participantId, month, referenceId: generateReferenceId(), amountCents }).run();
      return;
    } catch (err) {
      if (isReferenceCollision(err)) continue;
      throw err;
    }
  }
  throw new Error("Keine freie Referenz-ID gefunden");
}

/**
 * Legt für alle zahlungspflichtigen Teilnehmer (nicht den Admin, Betrag > 0) die Monatszahlung an,
 * falls sie fehlt. Bestehende Zahlungen bleiben unverändert (Betrag ist ein Snapshot). Nur bis zum aktuellen Monat.
 */
export function ensureMonthPayments(db: Db, month: Month, now: Date = new Date()): MonthResult {
  assertMonth(month);
  if (month > currentMonth(now)) throw new Error("Zukünftige Monate werden nicht abgerechnet");
  const input = loadBillingInput(db);
  const result = computeMonth(month, input.subscriptions, input.participants);
  db.transaction((tx) => {
    for (const t of result.totals) {
      if (!t.payable) continue;
      const exists = tx.select({ id: payments.id }).from(payments).where(and(eq(payments.participantId, t.participantId), eq(payments.month, month))).get();
      if (!exists) insertPayment(tx as unknown as Db, t.participantId, month, t.totalCents);
    }
  });
  return result;
}

export type ParticipantPaidResult = "ok" | "not_found" | "locked";

/** Teilnehmer: "Ich habe bezahlt" setzen oder zurücknehmen (nur solange nicht bestätigt). */
export function setPaidByParticipant(db: Db, participantId: number, month: Month, paid: boolean, now: Date = new Date()): ParticipantPaidResult {
  const row = db.select().from(payments).where(and(eq(payments.participantId, participantId), eq(payments.month, month))).get();
  if (!row) return "not_found";
  if (row.status === "confirmed") return "locked";
  db.update(payments)
    .set(paid ? { status: "marked_paid", markedPaidAt: now.toISOString() } : { status: "open", markedPaidAt: null })
    .where(eq(payments.id, row.id))
    .run();
  return "ok";
}

/** Admin: Status frei setzen (bestätigen, zurücksetzen). */
export function setStatusByAdmin(db: Db, paymentId: number, status: PaymentStatus, now: Date = new Date()): boolean {
  const row = db.select().from(payments).where(eq(payments.id, paymentId)).get();
  if (!row) return false;
  const ts = now.toISOString();
  db.update(payments)
    .set({
      status,
      markedPaidAt: status === "open" ? null : (row.markedPaidAt ?? ts),
      confirmedAt: status === "confirmed" ? ts : null,
    })
    .where(eq(payments.id, paymentId))
    .run();
  return true;
}
