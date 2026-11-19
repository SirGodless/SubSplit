import { and, eq, gt, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { mailOutbox, users } from "@/db/schema";
import { identityOf } from "@/lib/hub/identity";
import { makeUnsubscribeToken, readUnsubscribeToken, type UnsubscribePurpose } from "@/lib/mail/tokens";
import { testMail } from "@/lib/mail/templates";
import { AppError } from "./errors";
import { enqueueMail } from "./mail";

/** Was die Mail-Funktionen aus der Konfiguration brauchen. */
export interface MailCtx {
  appName: string;
  baseUrl: string;
  /** SESSION_SECRET, signiert die Abmelde-Links. */
  secret: string;
}

const MAX_PER_HOUR = 3;
const HOUR = 3600 * 1000;

/** Abmelde-Links einer Mail: Seite (im Text) und One-Click-Endpunkt (im Header). */
export function unsubscribeLinks(ctx: MailCtx, userId: number, purpose: UnsubscribePurpose): { page: string; oneClick: string } {
  const token = makeUnsubscribeToken(ctx.secret, userId, purpose);
  return { page: `${ctx.baseUrl}/unsubscribe/${token}`, oneClick: `${ctx.baseUrl}/api/unsubscribe/${token}` };
}

// ---------- Test-Mail und Einstellungen ----------

/** Test-Mail an die eigene, bestätigte Adresse. Höchstens 3 pro Stunde. */
export function requestTestMail(db: Db, ctx: MailCtx, userId: number, now: Date = new Date()): void {
  const u = identityOf(userId);
  if (!u || u.banned || !u.access) throw new AppError("not_found", "Konto nicht gefunden.");
  if (!u.email || !u.emailVerified) throw new AppError("not_allowed", "Dein Konto im Hub hat keine bestätigte E-Mail-Adresse.");
  const recent = db
    .select({ c: sql<number>`count(*)` })
    .from(mailOutbox)
    .where(and(eq(mailOutbox.toUserId, userId), eq(mailOutbox.type, "test"), gt(mailOutbox.createdAt, new Date(now.getTime() - HOUR).toISOString())))
    .get();
  if ((recent?.c ?? 0) >= MAX_PER_HOUR) throw new AppError("not_allowed", "Du hast in der letzten Stunde schon mehrere Test-Mails angefordert. Bitte warte etwas.");
  const m = testMail({ appName: ctx.appName, name: u.username });
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
