import { and, eq, gte, lt, or, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { memberships, participants, payments, subscriptionPrices, subscriptions } from "@/db/schema";
import { addMonths, assertMonth, currentMonth, type Month } from "@/lib/billing/month";
import { generateToken, hashToken } from "@/lib/security/tokens";

export class AdminError extends Error {
  constructor(public readonly code: "not_allowed" | "not_found" | "invalid", message: string) {
    super(message);
    this.name = "AdminError";
  }
}

/**
 * Änderungen an Preis/Gewicht/Beteiligung gelten ab Monat M. Erlaubt nur, wenn M nicht in der
 * Vergangenheit liegt und für Monate >= M noch keine Zahlungen erzeugt wurden (sonst würden
 * bereits eingefrorene Beträge nicht mehr zur Berechnung passen).
 */
export function assertChangeAllowed(db: Db, effectiveFrom: Month, now: Date = new Date()): void {
  assertMonth(effectiveFrom);
  if (effectiveFrom < currentMonth(now)) throw new AdminError("not_allowed", "Änderungen wirken nur ab dem aktuellen Monat.");
  const row = db.select({ c: sql<number>`count(*)` }).from(payments).where(gte(payments.month, effectiveFrom)).get();
  if ((row?.c ?? 0) > 0) throw new AdminError("not_allowed", `Für ${effectiveFrom} oder später existieren bereits Zahlungen – Änderung frühestens ab dem nächsten Monat.`);
}

const validCents = (c: number) => Number.isSafeInteger(c) && c >= 0 && c <= 10_000_000;
const validWeight = (w: number) => Number.isSafeInteger(w) && w >= 1 && w <= 1000;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;

export function normalizeEmail(email: string | null | undefined): string | null {
  const v = (email ?? "").trim();
  if (!v) return null;
  if (v.length > 320 || !EMAIL_RE.test(v)) throw new AdminError("invalid", "Ungültige E-Mail-Adresse.");
  return v;
}

function cleanName(name: string, label: string): string {
  const v = name.trim();
  if (!v || v.length > 60) throw new AdminError("invalid", `${label} muss 1-60 Zeichen lang sein.`);
  return v;
}

// ---------- Abos & Preise ----------

export function createSubscription(db: Db, input: { name: string; priceCents: number; validFromMonth: Month }, now = new Date()): number {
  const name = cleanName(input.name, "Abo-Name");
  if (!validCents(input.priceCents)) throw new AdminError("invalid", "Ungültiger Preis.");
  assertChangeAllowed(db, input.validFromMonth, now);
  return db.transaction((tx) => {
    const s = tx.insert(subscriptions).values({ name }).returning({ id: subscriptions.id }).get();
    tx.insert(subscriptionPrices).values({ subscriptionId: s.id, validFromMonth: input.validFromMonth, amountCents: input.priceCents }).run();
    return s.id;
  });
}

export function renameSubscription(db: Db, id: number, name: string): void {
  const res = db.update(subscriptions).set({ name: cleanName(name, "Abo-Name") }).where(eq(subscriptions.id, id)).run();
  if (res.changes === 0) throw new AdminError("not_found", "Abo nicht gefunden.");
}

/** Neuer Preis ab Monat; ersetzt einen vorhandenen Eintrag desselben Monats. Spätere Einträge bleiben bestehen. */
export function setPrice(db: Db, subscriptionId: number, validFromMonth: Month, priceCents: number, now = new Date()): void {
  if (!validCents(priceCents)) throw new AdminError("invalid", "Ungültiger Preis.");
  assertChangeAllowed(db, validFromMonth, now);
  if (!db.select({ id: subscriptions.id }).from(subscriptions).where(eq(subscriptions.id, subscriptionId)).get()) throw new AdminError("not_found", "Abo nicht gefunden.");
  db.insert(subscriptionPrices)
    .values({ subscriptionId, validFromMonth, amountCents: priceCents })
    .onConflictDoUpdate({ target: [subscriptionPrices.subscriptionId, subscriptionPrices.validFromMonth], set: { amountCents: priceCents } })
    .run();
}

// ---------- Teilnehmer & Magic-Links ----------

export function createParticipant(db: Db, input: { displayName: string; email?: string | null; isOwner?: boolean }): { id: number; token: string } {
  const displayName = cleanName(input.displayName, "Anzeigename");
  const email = normalizeEmail(input.email);
  const token = generateToken();
  const unsubscribe = generateToken();
  try {
    const row = db
      .insert(participants)
      .values({ displayName, email, isOwner: input.isOwner ?? false, tokenHash: hashToken(token), unsubscribeTokenHash: hashToken(unsubscribe) })
      .returning({ id: participants.id })
      .get();
    return { id: row.id, token };
  } catch (err) {
    if (err instanceof Error && /participants\.is_owner|participants_single_owner/.test(err.message)) throw new AdminError("invalid", "Es gibt bereits einen Admin-Teilnehmer.");
    throw err;
  }
}

export function updateParticipant(db: Db, id: number, input: { displayName?: string; email?: string | null; remindersEnabled?: boolean }): void {
  const set: Partial<typeof participants.$inferInsert> = {};
  if (input.displayName !== undefined) set.displayName = cleanName(input.displayName, "Anzeigename");
  if (input.email !== undefined) set.email = normalizeEmail(input.email);
  if (input.remindersEnabled !== undefined) set.remindersEnabled = input.remindersEnabled;
  if (Object.keys(set).length === 0) return;
  const res = db.update(participants).set(set).where(eq(participants.id, id)).run();
  if (res.changes === 0) throw new AdminError("not_found", "Teilnehmer nicht gefunden.");
}

/** Erzeugt einen neuen Link; der alte ist sofort ungültig. Der Klartext-Token wird nur hier zurückgegeben. */
export function regenerateToken(db: Db, id: number): string {
  const token = generateToken();
  const res = db
    .update(participants)
    .set({ tokenHash: hashToken(token), tokenRevokedAt: null })
    .where(and(eq(participants.id, id), eq(participants.isOwner, false)))
    .run();
  if (res.changes === 0) throw new AdminError("not_found", "Teilnehmer nicht gefunden.");
  return token;
}

export function revokeToken(db: Db, id: number, now = new Date()): void {
  const res = db.update(participants).set({ tokenRevokedAt: now.toISOString() }).where(eq(participants.id, id)).run();
  if (res.changes === 0) throw new AdminError("not_found", "Teilnehmer nicht gefunden.");
}

// ---------- Beteiligungen ----------

function requireRefs(db: Db, subscriptionId: number, participantId: number) {
  if (!db.select({ id: subscriptions.id }).from(subscriptions).where(eq(subscriptions.id, subscriptionId)).get()) throw new AdminError("not_found", "Abo nicht gefunden.");
  if (!db.select({ id: participants.id }).from(participants).where(eq(participants.id, participantId)).get()) throw new AdminError("not_found", "Teilnehmer nicht gefunden.");
}

/** Schneidet bestehende Beteiligungen so zu, dass ab `from` nichts mehr überlappt. */
function clearFrom(tx: Db, subscriptionId: number, participantId: number, from: Month): void {
  const same = and(eq(memberships.subscriptionId, subscriptionId), eq(memberships.participantId, participantId));
  tx.delete(memberships).where(and(same, gte(memberships.validFromMonth, from))).run();
  tx.update(memberships)
    .set({ validToMonth: addMonths(from, -1) })
    .where(and(same, lt(memberships.validFromMonth, from), or(isNull(memberships.validToMonth), gte(memberships.validToMonth, from))))
    .run();
}

/** Beteiligung bzw. neues Gewicht ab Monat `from` (unbefristet). */
export function setMembership(db: Db, input: { subscriptionId: number; participantId: number; weight: number; from: Month }, now = new Date()): void {
  if (!validWeight(input.weight)) throw new AdminError("invalid", "Gewicht muss eine ganze Zahl von 1 bis 1000 sein.");
  assertChangeAllowed(db, input.from, now);
  requireRefs(db, input.subscriptionId, input.participantId);
  db.transaction((tx) => {
    clearFrom(tx as unknown as Db, input.subscriptionId, input.participantId, input.from);
    tx.insert(memberships).values({ subscriptionId: input.subscriptionId, participantId: input.participantId, weight: input.weight, validFromMonth: input.from }).run();
  });
}

/** Beteiligung endet nach `lastMonth` (inklusive); wirkt also ab dem Folgemonat. */
export function endMembership(db: Db, input: { subscriptionId: number; participantId: number; lastMonth: Month }, now = new Date()): void {
  assertMonth(input.lastMonth);
  assertChangeAllowed(db, addMonths(input.lastMonth, 1), now);
  requireRefs(db, input.subscriptionId, input.participantId);
  db.transaction((tx) => {
    clearFrom(tx as unknown as Db, input.subscriptionId, input.participantId, addMonths(input.lastMonth, 1));
  });
}

