import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { participants, payments } from "@/db/schema";
import { computeMonth } from "@/lib/billing/compute";
import { assertMonth, currentMonth, type Month } from "@/lib/billing/month";
import { hashToken, isWellFormedToken } from "@/lib/security/tokens";
import type { AuthFailReason, SecurityLogger } from "@/lib/security/security-log";
import { loadBillingInput } from "./billing-data";
import { ensureMonthPayments, type PaymentStatus } from "./payments";

/**
 * Was ein Teilnehmer sehen darf – und NUR das. Die Struktur wird feldweise aufgebaut; E-Mail,
 * Token, fremde Referenz-IDs/Status/Summen und fremde Abos kommen nie in dieses Objekt.
 */
export interface ParticipantView {
  displayName: string;
  month: Month;
  /** Monate, die der Teilnehmer ansehen kann (neueste zuerst). */
  months: Month[];
  totalCents: number;
  /** Eigene Monatszahlung; null, wenn für den Monat nichts zu zahlen ist. */
  payment: { referenceId: string; status: PaymentStatus; amountCents: number } | null;
  subscriptions: Array<{
    name: string;
    priceCents: number;
    /** Rundungsrest, der beim Admin verbleibt, wenn dieser nicht selbst im Abo ist. */
    restCents: number;
    lines: Array<{ displayName: string; weight: number; percent: number; amountCents: number; isYou: boolean }>;
  }>;
}

export type TokenAuth = { kind: "ok"; participantId: number } | { kind: "denied" };

/**
 * Prüft einen Magic-Link-Token. Unbekannt/ungültig -> AUTHFAIL-Logzeile; widerrufen -> nur NOTICE.
 * Beide Fälle liefern dem Aufrufer dasselbe Ergebnis ("denied"), damit der Client sie nicht unterscheiden kann.
 */
export function authenticateToken(db: Db, token: string, ip: string, logger: SecurityLogger): TokenAuth {
  const fail = (reason: AuthFailReason): TokenAuth => {
    logger.authFail(ip, reason);
    return { kind: "denied" };
  };
  if (!isWellFormedToken(token)) return fail("invalid_token");
  const row = db
    .select({ id: participants.id, revokedAt: participants.tokenRevokedAt, isOwner: participants.isOwner })
    .from(participants)
    .where(eq(participants.tokenHash, hashToken(token)))
    .get();
  if (!row || row.isOwner) return fail("invalid_token");
  if (row.revokedAt) {
    logger.notice(ip, "revoked_token");
    return { kind: "denied" };
  }
  return { kind: "ok", participantId: row.id };
}

export function getParticipantView(db: Db, participantId: number, requestedMonth?: string, now: Date = new Date()): ParticipantView | null {
  const current = currentMonth(now);
  const month = requestedMonth ?? current;
  assertMonth(month);

  const me = db.select({ displayName: participants.displayName, isOwner: participants.isOwner }).from(participants).where(eq(participants.id, participantId)).get();
  if (!me || me.isOwner) return null;

  ensureMonthPayments(db, current, now);
  const own = db
    .select({ month: payments.month })
    .from(payments)
    .where(eq(payments.participantId, participantId))
    .all()
    .map((r) => r.month);
  const months = [...new Set([current, ...own])].filter((m) => m <= current).sort().reverse();
  if (!months.includes(month)) return null;

  const input = loadBillingInput(db);
  const result = computeMonth(month, input.subscriptions, input.participants);
  const names = new Map(input.participants.map((p) => [p.id, p.displayName]));

  const subscriptions = result.subscriptions
    .filter((s) => s.lines.some((l) => l.participantId === participantId))
    .map((s) => ({
      name: s.name,
      priceCents: s.priceCents,
      restCents: s.restCents,
      lines: s.lines.map((l) => ({
        displayName: names.get(l.participantId) ?? "?",
        weight: l.weight,
        percent: l.percent,
        amountCents: l.amountCents,
        isYou: l.participantId === participantId,
      })),
    }));

  const pay = db
    .select({ referenceId: payments.referenceId, status: payments.status, amountCents: payments.amountCents })
    .from(payments)
    .where(and(eq(payments.participantId, participantId), eq(payments.month, month)))
    .get();

  return {
    displayName: me.displayName,
    month,
    months,
    totalCents: result.totals.find((t) => t.participantId === participantId)?.totalCents ?? 0,
    payment: pay ? { referenceId: pay.referenceId, status: pay.status, amountCents: pay.amountCents } : null,
    subscriptions,
  };
}
