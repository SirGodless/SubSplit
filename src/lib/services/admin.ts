import { and, eq, gt, gte, lt, ne, or, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { memberships, participants, payments, subscriptionPrices, subscriptions } from "@/db/schema";
import { addMonths, assertMonth, currentMonth, type Month } from "@/lib/billing/month";
import { generateToken, hashToken } from "@/lib/security/tokens";
import { reconcileOpenPayments } from "./payments";

export class AdminError extends Error {
  constructor(public readonly code: "not_allowed" | "not_found" | "invalid", message: string) {
    super(message);
    this.name = "AdminError";
  }
}

/**
 * Früheste Monat, ab dem sich Preis/Gewicht/Beteiligung noch ändern lassen: der aktuelle Monat, solange
 * dort keine Zahlung als bezahlt gemeldet oder bestätigt ist; sonst der Monat danach. Vergangene Monate sind fest.
 * Noch OFFENE Zahlungen werden nach einer Änderung automatisch neu berechnet (siehe reconcileOpenPayments).
 */
export function earliestChangeMonth(db: Db, now: Date = new Date()): Month {
  const cur = currentMonth(now);
  const row = db.select({ m: sql<string | null>`max(${payments.month})` }).from(payments).where(ne(payments.status, "open")).get();
  const last = row?.m ?? null;
  return last !== null && last >= cur ? addMonths(last, 1) : cur;
}

export function assertChangeAllowed(db: Db, effectiveFrom: Month, now: Date = new Date()): void {
  assertMonth(effectiveFrom);
  const cur = currentMonth(now);
  if (effectiveFrom < cur) throw new AdminError("not_allowed", "Änderungen wirken nur ab dem aktuellen Monat.");
  const earliest = earliestChangeMonth(db, now);
  if (effectiveFrom < earliest)
    throw new AdminError("not_allowed", `Für ${effectiveFrom} gibt es bereits als bezahlt gemeldete oder bestätigte Zahlungen – Änderung frühestens ab ${earliest}.`);
}

function assertActive(db: Db, subscriptionId: number): void {
  const s = db.select({ archivedAt: subscriptions.archivedAt }).from(subscriptions).where(eq(subscriptions.id, subscriptionId)).get();
  if (!s) throw new AdminError("not_found", "Abo nicht gefunden.");
  if (s.archivedAt) throw new AdminError("invalid", "Das Abo ist beendet. Bitte zuerst wieder aktivieren.");
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
  assertActive(db, subscriptionId);
  db.transaction((tx) => {
    tx.insert(subscriptionPrices)
      .values({ subscriptionId, validFromMonth, amountCents: priceCents })
      .onConflictDoUpdate({ target: [subscriptionPrices.subscriptionId, subscriptionPrices.validFromMonth], set: { amountCents: priceCents } })
      .run();
    reconcileOpenPayments(tx as unknown as Db, validFromMonth, now);
  });
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
  assertActive(db, input.subscriptionId);
  db.transaction((tx) => {
    clearFrom(tx as unknown as Db, input.subscriptionId, input.participantId, input.from);
    tx.insert(memberships).values({ subscriptionId: input.subscriptionId, participantId: input.participantId, weight: input.weight, validFromMonth: input.from }).run();
    reconcileOpenPayments(tx as unknown as Db, input.from, now);
  });
}

/** Beteiligung endet nach `lastMonth` (inklusive); wirkt also ab dem Folgemonat. */
export function endMembership(db: Db, input: { subscriptionId: number; participantId: number; lastMonth: Month }, now = new Date()): void {
  assertMonth(input.lastMonth);
  assertChangeAllowed(db, addMonths(input.lastMonth, 1), now);
  requireRefs(db, input.subscriptionId, input.participantId);
  db.transaction((tx) => {
    clearFrom(tx as unknown as Db, input.subscriptionId, input.participantId, addMonths(input.lastMonth, 1));
    reconcileOpenPayments(tx as unknown as Db, addMonths(input.lastMonth, 1), now);
  });
}

// ---------- Abo beenden / wieder aktivieren / löschen ----------

/** Beendet das Abo nach `lastMonth`: alle Beteiligungen enden, das Abo wird archiviert. Vergangene Monate bleiben unverändert. */
export function endSubscription(db: Db, id: number, lastMonth: Month, now = new Date()): void {
  assertMonth(lastMonth);
  const from = addMonths(lastMonth, 1);
  assertChangeAllowed(db, from, now);
  if (!db.select({ id: subscriptions.id }).from(subscriptions).where(eq(subscriptions.id, id)).get()) throw new AdminError("not_found", "Abo nicht gefunden.");
  db.transaction((tx) => {
    tx.delete(memberships).where(and(eq(memberships.subscriptionId, id), gt(memberships.validFromMonth, lastMonth))).run();
    tx.update(memberships)
      .set({ validToMonth: lastMonth })
      .where(and(eq(memberships.subscriptionId, id), or(isNull(memberships.validToMonth), gt(memberships.validToMonth, lastMonth))))
      .run();
    tx.update(subscriptions).set({ archivedAt: now.toISOString() }).where(eq(subscriptions.id, id)).run();
    reconcileOpenPayments(tx as unknown as Db, from, now);
  });
}

export function reactivateSubscription(db: Db, id: number): void {
  const res = db.update(subscriptions).set({ archivedAt: null }).where(eq(subscriptions.id, id)).run();
  if (res.changes === 0) throw new AdminError("not_found", "Abo nicht gefunden.");
}

/**
 * Endgültig löschen (mit Preisen und Beteiligungen). Nur, solange das Abo in keiner abgeschlossenen
 * oder bezahlten Abrechnung vorkommt: In vergangenen Monaten oder bei bezahlt gemeldeten/bestätigten Zahlungen
 * ab dem ersten Monat des Abos ist das nicht mehr möglich – dann stattdessen beenden.
 */
export function deleteSubscription(db: Db, id: number, now = new Date()): void {
  if (!db.select({ id: subscriptions.id }).from(subscriptions).where(eq(subscriptions.id, id)).get()) throw new AdminError("not_found", "Abo nicht gefunden.");
  const months = [
    ...db.select({ m: subscriptionPrices.validFromMonth }).from(subscriptionPrices).where(eq(subscriptionPrices.subscriptionId, id)).all().map((r) => r.m),
    ...db.select({ m: memberships.validFromMonth }).from(memberships).where(eq(memberships.subscriptionId, id)).all().map((r) => r.m),
  ].sort();
  const first = months[0];
  const cur = currentMonth(now);
  if (first !== undefined) {
    const blocking = db
      .select({ c: sql<number>`count(*)` })
      .from(payments)
      .where(and(gte(payments.month, first), or(lt(payments.month, cur), ne(payments.status, "open"))))
      .get();
    if ((blocking?.c ?? 0) > 0)
      throw new AdminError("not_allowed", "Das Abo wurde bereits abgerechnet und kann nicht mehr gelöscht werden. Bitte stattdessen beenden.");
  }
  db.transaction((tx) => {
    tx.delete(subscriptions).where(eq(subscriptions.id, id)).run();
    reconcileOpenPayments(tx as unknown as Db, cur, now);
  });
}

