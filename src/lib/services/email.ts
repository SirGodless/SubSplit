import { and, eq, gt, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { emailVerifications, mailOutbox, users } from "@/db/schema";
import { makeUnsubscribeToken, readUnsubscribeToken, type UnsubscribePurpose } from "@/lib/mail/tokens";
import { testMail, verifyEmailMail } from "@/lib/mail/templates";
import type { SecurityLogger } from "@/lib/security/security-log";
import { generateToken, hashToken, isWellFormedToken } from "@/lib/security/tokens";
import { AppError } from "./errors";
import { enqueueMail } from "./mail";

/** Was die Mail-Funktionen aus der Konfiguration brauchen. */
export interface MailCtx {
  appName: string;
  baseUrl: string;
  /** SESSION_SECRET, signiert die Abmelde-Links. */
  secret: string;
}

export const VERIFY_TTL_MS = 48 * 60 * 60 * 1000;
const MAX_PER_HOUR = 3;
const HOUR = 3600 * 1000;

/** Abmelde-Links einer Mail: Seite (im Text) und One-Click-Endpunkt (im Header). */
export function unsubscribeLinks(ctx: MailCtx, userId: number, purpose: UnsubscribePurpose): { page: string; oneClick: string } {
  const token = makeUnsubscribeToken(ctx.secret, userId, purpose);
  return { page: `${ctx.baseUrl}/unsubscribe/${token}`, oneClick: `${ctx.baseUrl}/api/unsubscribe/${token}` };
}

// ---------- Adresse bestätigen (Double-Opt-In) ----------

/** Schickt einen Bestätigungslink an die hinterlegte, noch unbestätigte Adresse. Höchstens 3 pro Stunde. */
export function startEmailVerification(db: Db, ctx: MailCtx, userId: number, now: Date = new Date()): void {
  const u = db.select().from(users).where(eq(users.id, userId)).get();
  if (!u || u.disabledAt) throw new AppError("not_found", "Konto nicht gefunden.");
  if (!u.email) throw new AppError("invalid", "Es ist keine E-Mail-Adresse hinterlegt.");
  if (u.emailVerifiedAt) throw new AppError("invalid", "Die Adresse ist schon bestätigt.");
  const recent = db
    .select({ c: sql<number>`count(*)` })
    .from(emailVerifications)
    .where(and(eq(emailVerifications.userId, userId), gt(emailVerifications.createdAt, new Date(now.getTime() - HOUR).toISOString())))
    .get();
  if ((recent?.c ?? 0) >= MAX_PER_HOUR) throw new AppError("not_allowed", "Du hast in der letzten Stunde schon mehrere Bestätigungsmails angefordert. Bitte warte etwas.");
  const token = generateToken();
  db.insert(emailVerifications)
    .values({ userId, email: u.email, tokenHash: hashToken(token), expiresAt: new Date(now.getTime() + VERIFY_TTL_MS).toISOString(), createdAt: now.toISOString() })
    .run();
  const m = verifyEmailMail({ appName: ctx.appName, name: u.displayName, link: `${ctx.baseUrl}/verify-email/${token}` });
  enqueueMail(db, { toUserId: userId, toAddress: u.email, type: "verify_email", subject: m.subject, bodyText: m.text }, now);
}

/** Prüft den Link beim Öffnen. Unbekannt -> AUTHFAIL; benutzt/abgelaufen -> nur NOTICE (kein Ban). */
export function peekEmailVerification(db: Db, token: string, ip: string, logger: SecurityLogger, now: Date = new Date()): boolean {
  if (!isWellFormedToken(token)) {
    logger.authFail(ip, "invalid_token");
    return false;
  }
  const row = db.select().from(emailVerifications).where(eq(emailVerifications.tokenHash, hashToken(token))).get();
  if (!row) {
    logger.authFail(ip, "invalid_token");
    return false;
  }
  if (row.usedAt || row.expiresAt <= now.toISOString()) {
    logger.notice(ip, "revoked_token");
    return false;
  }
  return true;
}

/** Bestätigt die Adresse, falls sie noch die aktuelle des Kontos ist. */
export function confirmEmailVerification(db: Db, token: string, now: Date = new Date()): void {
  const bad = () => new AppError("not_found", "Der Link ist ungültig oder abgelaufen.");
  if (!isWellFormedToken(token)) throw bad();
  const row = db.select().from(emailVerifications).where(eq(emailVerifications.tokenHash, hashToken(token))).get();
  if (!row || row.usedAt || row.expiresAt <= now.toISOString()) throw bad();
  const u = db.select({ email: users.email, disabledAt: users.disabledAt }).from(users).where(eq(users.id, row.userId)).get();
  if (!u || u.disabledAt || u.email !== row.email) throw bad(); // Adresse wurde inzwischen geändert
  db.transaction((tx) => {
    tx.update(users).set({ emailVerifiedAt: now.toISOString() }).where(eq(users.id, row.userId)).run();
    tx.update(emailVerifications).set({ usedAt: now.toISOString() }).where(eq(emailVerifications.id, row.id)).run();
  });
}

// ---------- Test-Mail und Einstellungen ----------

/** Test-Mail an die eigene, bestätigte Adresse. Höchstens 3 pro Stunde. */
export function requestTestMail(db: Db, ctx: MailCtx, userId: number, now: Date = new Date()): void {
  const u = db.select().from(users).where(eq(users.id, userId)).get();
  if (!u || u.disabledAt) throw new AppError("not_found", "Konto nicht gefunden.");
  if (!u.email || !u.emailVerifiedAt) throw new AppError("not_allowed", "Bitte zuerst eine E-Mail-Adresse eintragen und bestätigen.");
  const recent = db
    .select({ c: sql<number>`count(*)` })
    .from(mailOutbox)
    .where(and(eq(mailOutbox.toUserId, userId), eq(mailOutbox.type, "test"), gt(mailOutbox.createdAt, new Date(now.getTime() - HOUR).toISOString())))
    .get();
  if ((recent?.c ?? 0) >= MAX_PER_HOUR) throw new AppError("not_allowed", "Du hast in der letzten Stunde schon mehrere Test-Mails angefordert. Bitte warte etwas.");
  const m = testMail({ appName: ctx.appName, name: u.displayName });
  enqueueMail(db, { toUserId: userId, toAddress: u.email, type: "test", subject: m.subject, bodyText: m.text }, now);
}

export function setNotificationPrefs(db: Db, userId: number, prefs: { remindersEnabled?: boolean; priceMailsEnabled?: boolean }): void {
  const set: Partial<typeof users.$inferInsert> = {};
  if (prefs.remindersEnabled !== undefined) set.remindersEnabled = prefs.remindersEnabled;
  if (prefs.priceMailsEnabled !== undefined) set.priceMailsEnabled = prefs.priceMailsEnabled;
  if (Object.keys(set).length === 0) return;
  if (db.update(users).set(set).where(eq(users.id, userId)).run().changes === 0) throw new AppError("not_found", "Konto nicht gefunden.");
}

/** Abmelde-Link aus einer Mail: schaltet die jeweilige Art von Mails ab. null = ungültiger Link. */
export function applyUnsubscribe(db: Db, secret: string, token: string): { purpose: UnsubscribePurpose } | null {
  const t = readUnsubscribeToken(secret, token);
  if (!t) return null;
  const res = db
    .update(users)
    .set(t.purpose === "reminders" ? { remindersEnabled: false } : { priceMailsEnabled: false })
    .where(eq(users.id, t.userId))
    .run();
  return res.changes > 0 ? { purpose: t.purpose } : null;
}
