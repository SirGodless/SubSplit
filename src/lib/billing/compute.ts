import { allocate } from "./allocate";
import { assertMonth, type Month } from "./month";

export interface PriceInput {
  validFromMonth: Month;
  amountCents: number;
}
export interface MembershipInput {
  /** Konto-ID des Mitzahlers. */
  participantId: number;
  weight: number;
  validFromMonth: Month;
  validToMonth: Month | null;
}
export interface SubscriptionInput {
  id: number;
  name: string;
  prices: PriceInput[];
  memberships: MembershipInput[];
}
export interface ParticipantInput {
  id: number;
  displayName: string;
}

export interface ShareLine {
  participantId: number;
  weight: number;
  /** Nur zur Anzeige (aus Gewichten, 2 Nachkommastellen). */
  percent: number;
  amountCents: number;
}
export interface SubscriptionBreakdown {
  subscriptionId: number;
  name: string;
  priceCents: number;
  lines: ShareLine[];
  /** Rundungsrest, der beim Empfänger verbleibt, wenn er selbst nicht im Abo ist (Summe lines + restCents = priceCents). */
  restCents: number;
}
export interface ParticipantTotal {
  participantId: number;
  isOwner: boolean;
  /** Summe der bereits gerundeten Anteile. */
  totalCents: number;
  /** Nur Beteiligte außer dem Empfänger mit Betrag > 0 schulden eine Monatszahlung. */
  payable: boolean;
}
export interface MonthResult {
  month: Month;
  subscriptions: SubscriptionBreakdown[];
  totals: ParticipantTotal[];
  /** Gesamtkosten aller Abos des Monats (Summe der Abo-Preise, nur Abos mit Beteiligten). */
  totalCostCents: number;
  /** Summe der Rundungsreste, die beim Empfänger bleiben. */
  restCents: number;
}

/** Gültiger Preis eines Monats: Eintrag mit größtem validFromMonth <= month; null, wenn keiner. */
export function priceForMonth(prices: PriceInput[], month: Month): number | null {
  let best: PriceInput | undefined;
  for (const p of prices) {
    if (p.validFromMonth <= month && (!best || p.validFromMonth > best.validFromMonth)) best = p;
  }
  return best ? best.amountCents : null;
}

export function activeMemberships(memberships: MembershipInput[], month: Month): MembershipInput[] {
  return memberships.filter((m) => m.validFromMonth <= month && (m.validToMonth === null || month <= m.validToMonth));
}

/**
 * Berechnet einen Monat für die Abos EINES Empfängers (ownerId). Der Empfänger bekommt den Rundungsrest
 * und schuldet sich selbst nichts. Es gilt: totalCostCents == Summe(totals) + restCents.
 */
export function computeMonth(
  month: Month,
  subscriptions: SubscriptionInput[],
  participants: ParticipantInput[],
  ownerId: number | null,
): MonthResult {
  assertMonth(month);
  const breakdowns: SubscriptionBreakdown[] = [];
  const totals = new Map<number, number>();
  let totalCostCents = 0;
  let restTotal = 0;

  for (const sub of [...subscriptions].sort((a, b) => a.id - b.id)) {
    const price = priceForMonth(sub.prices, month);
    if (price === null) continue;
    const members = activeMemberships(sub.memberships, month);
    if (members.length === 0) continue;
    const { shares, restCents } = allocate(price, members, ownerId);
    const totalWeight = members.reduce((s, m) => s + m.weight, 0);
    const lines: ShareLine[] = shares.map((s) => ({
      participantId: s.participantId,
      weight: s.weight,
      percent: Math.round((s.weight * 10000) / totalWeight) / 100,
      amountCents: s.amountCents,
    }));
    for (const l of lines) totals.set(l.participantId, (totals.get(l.participantId) ?? 0) + l.amountCents);
    breakdowns.push({ subscriptionId: sub.id, name: sub.name, priceCents: price, lines, restCents });
    totalCostCents += price;
    restTotal += restCents;
  }

  const known = new Set(participants.map((p) => p.id));
  const result: ParticipantTotal[] = [];
  for (const [participantId, totalCents] of [...totals].sort((a, b) => a[0] - b[0])) {
    if (!known.has(participantId)) throw new Error(`Konto ${participantId} unbekannt`);
    const isOwner = participantId === ownerId;
    result.push({ participantId, isOwner, totalCents, payable: !isOwner && totalCents > 0 });
  }
  return { month, subscriptions: breakdowns, totals: result, totalCostCents, restCents: restTotal };
}
