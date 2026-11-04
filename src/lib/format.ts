const eur = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });

export function formatEuro(cents: number): string {
  return eur.format(cents / 100);
}

export function formatMonth(month: string): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, 1)));
}

export function formatPercent(p: number): string {
  return `${new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 }).format(p)} %`;
}

export function formatDueDate(month: string, dueDay: number): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return `${String(dueDay).padStart(2, "0")}.${String(m).padStart(2, "0")}.${y}`;
}

export const STATUS_LABEL = { open: "Offen", marked_paid: "Als bezahlt gemeldet", confirmed: "Bestätigt" } as const;

/** "12,99" / "12.5" / "12" -> Cent; sonst null. Nur Integer-Rechnung. */
export function parseEuro(input: string): number | null {
  const m = /^\s*(\d{1,6})(?:[.,](\d{1,2}))?\s*$/.exec(input);
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0") || 0);
}
