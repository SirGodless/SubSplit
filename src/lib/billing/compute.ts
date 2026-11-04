import { allocate } from "./allocate";
import { assertMonth, type Month } from "./month";

export interface PriceInput {
  validFromMonth: Month;
  amountCents: number;
}
export interface MembershipInput {
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
  isOwner: boolean;
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
  /** Rundungsrest, der beim Admin verbleibt, wenn er selbst nicht im Abo ist (Summe lines + restCents = priceCents). */
  restCents: number;
}
export interface ParticipantTotal {
  participantId: number;
  isOwner: boolean;
  /** Summe der bereits gerundeten Anteile. */
  totalCents: number;
  /** Nur Nicht-Owner mit Betrag > 0 schulden eine Monatszahlung. */
  payable: boolean;
}
export interface MonthResult {
  month: Month;
  subscriptions: SubscriptionBreakdown[];
  totals: ParticipantTotal[];
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

export function computeMonth(
  month: Month,
  subscriptions: SubscriptionInput[],
  participants: ParticipantInput[],
): MonthResult {
  assertMonth(month);
  const ownerId = participants.find((p) => p.isOwner)?.id ?? null;
  const breakdowns: SubscriptionBreakdown[] = [];
  const totals = new Map<number, number>();

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
  }

  const byId = new Map(participants.map((p) => [p.id, p]));
  const result: ParticipantTotal[] = [];
  for (const [participantId, totalCents] of [...totals].sort((a, b) => a[0] - b[0])) {
    const p = byId.get(participantId);
    if (!p) throw new Error(`Teilnehmer ${participantId} unbekannt`);
    result.push({ participantId, isOwner: p.isOwner, totalCents, payable: !p.isOwner && totalCents > 0 });
  }
  return { month, subscriptions: breakdowns, totals: result };
}
