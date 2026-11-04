export interface Weighted {
  participantId: number;
  weight: number;
}
export interface Allocation {
  participantId: number;
  weight: number;
  amountCents: number;
}
export interface AllocationResult {
  shares: Allocation[];
  /** Rundungsrest, der keinem Teilnehmer zugeschrieben wurde (nur wenn der Empfänger nicht im Abo ist). */
  restCents: number;
}

/**
 * Verteilt priceCents nach Gewichten. Jeder Anteil wird auf den ganzen Cent ABGERUNDET; der Rest
 * (weniger als ein Cent pro Beteiligtem) wird dem Rest-Empfänger (Admin) zugeschrieben:
 *  - ist er im Abo, wird der Rest auf seinen Anteil gerechnet,
 *  - sonst bleibt er als restCents separat stehen.
 * Immer gilt: Summe(shares) + restCents == priceCents. Nur Integer-Rechnung.
 */
export function allocate(priceCents: number, members: Weighted[], restRecipientId: number | null = null): AllocationResult {
  if (!Number.isSafeInteger(priceCents) || priceCents < 0) throw new Error("Preis muss eine nichtnegative ganze Zahl in Cent sein");
  if (members.length === 0) return { shares: [], restCents: 0 };
  const seen = new Set<number>();
  let totalWeight = 0;
  for (const m of members) {
    if (!Number.isSafeInteger(m.weight) || m.weight < 1) throw new Error("Gewicht muss eine ganze Zahl >= 1 sein");
    if (seen.has(m.participantId)) throw new Error(`Teilnehmer ${m.participantId} doppelt im Abo`);
    seen.add(m.participantId);
    totalWeight += m.weight;
  }
  if (!Number.isSafeInteger(priceCents * totalWeight)) throw new Error("Wertebereich überschritten");

  const shares = members
    .map((m) => ({ participantId: m.participantId, weight: m.weight, amountCents: Math.floor((priceCents * m.weight) / totalWeight) }))
    .sort((a, b) => a.participantId - b.participantId);
  let rest = priceCents - shares.reduce((s, x) => s + x.amountCents, 0);

  const recipient = restRecipientId === null ? undefined : shares.find((s) => s.participantId === restRecipientId);
  if (recipient) {
    recipient.amountCents += rest;
    rest = 0;
  }
  return { shares, restCents: rest };
}
