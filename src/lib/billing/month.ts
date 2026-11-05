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

/** Heutiges Datum "YYYY-MM-DD" in der angegebenen Zeitzone (Standard: Europe/Berlin). */
export function berlinDate(now: Date = new Date(), timeZone = "Europe/Berlin"): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Fälligkeitsdatum "YYYY-MM-DD" eines Monats (Tag 1-28). */
export function dueDateOf(month: Month, dueDay: number): string {
  return `${assertMonth(month)}-${String(dueDay).padStart(2, "0")}`;
}

/** Datum "YYYY-MM-DD" plus/minus Tage (reine Kalenderrechnung, ohne Zeitzonen-Effekte). */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Stunde (0-23) in der angegebenen Zeitzone (Standard: Europe/Berlin). */
export function berlinHour(now: Date = new Date(), timeZone = "Europe/Berlin"): number {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", hourCycle: "h23" }).format(now));
}

/** Erinnerungen gehen nur zwischen 8 und 20 Uhr (Berlin) raus. */
export function inSendWindow(now: Date = new Date()): boolean {
  const h = berlinHour(now);
  return h >= 8 && h < 20;
}
