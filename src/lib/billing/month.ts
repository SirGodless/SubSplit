/** Monate als "YYYY-MM"-Strings; lexikographische Ordnung = zeitliche Ordnung. */
export type Month = string;

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function isMonth(value: string): value is Month {
  return MONTH_RE.test(value);
}

export function assertMonth(value: string): Month {
  if (!isMonth(value)) throw new Error(`Ungültiger Monat: ${value}`);
  return value;
}

export function addMonths(month: Month, delta: number): Month {
  assertMonth(month);
  const [y, m] = month.split("-").map(Number) as [number, number];
  const idx = y * 12 + (m - 1) + delta;
  const ny = Math.floor(idx / 12);
  const nm = (idx % 12) + 1;
  return `${String(ny).padStart(4, "0")}-${String(nm).padStart(2, "0")}`;
}

/** Aktueller Monat in der angegebenen Zeitzone (Standard: Europe/Berlin). */
export function currentMonth(now: Date = new Date(), timeZone = "Europe/Berlin"): Month {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit" }).formatToParts(now);
  const y = parts.find((p) => p.type === "year")!.value;
  const m = parts.find((p) => p.type === "month")!.value;
  return `${y}-${m}`;
}
