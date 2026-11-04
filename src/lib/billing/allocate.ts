export interface Weighted {
  participantId: number;
  weight: number;
}
export interface Allocation {
  participantId: number;
  weight: number;
  amountCents: number;
}

/**
 * Verteilt priceCents nach Gewichten (Largest-Remainder). Die Summe der Anteile ist exakt priceCents.
 * Gleichstand beim Rest: kleinere participantId bekommt den Zusatzcent zuerst. Nur Integer-Rechnung.
 */
export function allocate(priceCents: number, members: Weighted[]): Allocation[] {
  if (!Number.isSafeInteger(priceCents) || priceCents < 0) throw new Error("Preis muss eine nichtnegative ganze Zahl in Cent sein");
  if (members.length === 0) return [];
  const seen = new Set<number>();
  let totalWeight = 0;
  for (const m of members) {
    if (!Number.isSafeInteger(m.weight) || m.weight < 1) throw new Error("Gewicht muss eine ganze Zahl >= 1 sein");
    if (seen.has(m.participantId)) throw new Error(`Teilnehmer ${m.participantId} doppelt im Abo`);
    seen.add(m.participantId);
    totalWeight += m.weight;
  }
  if (!Number.isSafeInteger(priceCents * totalWeight)) throw new Error("Wertebereich überschritten");

  const rows = members.map((m) => {
    const product = priceCents * m.weight;
    return { ...m, base: Math.floor(product / totalWeight), remainder: product % totalWeight };
  });
  let leftover = priceCents - rows.reduce((s, r) => s + r.base, 0);
  const order = [...rows].sort((a, b) => b.remainder - a.remainder || a.participantId - b.participantId);
  const bonus = new Map<number, number>();
  for (const r of order) {
    if (leftover <= 0) break;
    bonus.set(r.participantId, 1);
    leftover--;
  }
  return rows
    .map((r) => ({ participantId: r.participantId, weight: r.weight, amountCents: r.base + (bonus.get(r.participantId) ?? 0) }))
    .sort((a, b) => a.participantId - b.participantId);
}
