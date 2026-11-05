import { and, asc, eq, inArray, lt, lte } from "drizzle-orm";
import type { Db } from "@/db/client";
import { emailVerifications, mailOutbox, users } from "@/db/schema";
import type { MailTransport } from "@/lib/mail/transport";

export const MAX_ATTEMPTS = 5;
/** Wartezeit bis zum nächsten Versuch nach einem Fehler (Minuten). */
export const BACKOFF_MINUTES = [5, 30, 120, 720, 1440];
const RETENTION_DAYS = 60;

export type MailType = "verify_email" | "reminder" | "price_change" | "test";

export interface MailInput {
  toUserId: number | null;
  toAddress: string;
  type: MailType;
  /** Eindeutiger Schlüssel: dieselbe Mail wird nie zweimal angelegt. */
  dedupeKey?: string | null;
  subject: string;
  bodyText: string;
  unsubscribeUrl?: string | null;
}

/** Legt eine Mail im Postausgang an. Gibt null zurück, wenn der dedupeKey schon existiert. */
export function enqueueMail(db: Db, input: MailInput, now: Date = new Date()): number | null {
  const res = db
    .insert(mailOutbox)
    .values({
      toUserId: input.toUserId, toAddress: input.toAddress, type: input.type, dedupeKey: input.dedupeKey ?? null,
      subject: input.subject, bodyText: input.bodyText, unsubscribeUrl: input.unsubscribeUrl ?? null,
      createdAt: now.toISOString(), nextAttemptAt: now.toISOString(),
    })
    .onConflictDoNothing({ target: mailOutbox.dedupeKey })
    .returning({ id: mailOutbox.id })
    .get();
  return res?.id ?? null;
}

/** Fehlertext ohne E-Mail-Adressen und auf 200 Zeichen gekürzt (kommt in die Datenbank, nie ins Log). */
export function safeError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.replace(/[^\s<>"']+@[^\s<>"']+/g, "<adresse>").slice(0, 200);
}

export interface ProcessResult {
  sent: number;
  retried: number;
  failed: number;
}

/**
 * Verschickt fällige Mails. Vor jedem Versand wird geprüft, ob die Mail noch zulässig ist (Konto aktiv, Adresse
 * unverändert und bestätigt, Einstellung nicht abgeschaltet). Fehler führen zu Wiederholungen mit wachsendem Abstand,
 * nach MAX_ATTEMPTS zu "failed". Nach Erfolg werden Adresse und Text gelöscht (Datensparsamkeit).
 */
export async function processOutbox(db: Db, transport: MailTransport, now: Date = new Date(), limit = 25): Promise<ProcessResult> {
  const result: ProcessResult = { sent: 0, retried: 0, failed: 0 };
  const rows = db
    .select()
    .from(mailOutbox)
    .where(and(eq(mailOutbox.status, "pending"), lte(mailOutbox.nextAttemptAt, now.toISOString())))
    .orderBy(asc(mailOutbox.id))
    .limit(limit)
    .all();

  for (const row of rows) {
    const fail = (reason: string) => {
      db.update(mailOutbox).set({ status: "failed", lastError: reason, bodyText: "", toAddress: null }).where(eq(mailOutbox.id, row.id)).run();
      result.failed++;
    };
    const user = row.toUserId ? db.select().from(users).where(eq(users.id, row.toUserId)).get() : undefined;
    if (!row.toAddress) { fail("keine Adresse"); continue; }
    if (row.type !== "verify_email" || row.toUserId) {
      if (!user || user.disabledAt) { fail("Konto nicht mehr aktiv"); continue; }
      if (row.type !== "verify_email" && (user.email !== row.toAddress || !user.emailVerifiedAt)) { fail("Adresse nicht mehr bestätigt"); continue; }
      if (row.type === "reminder" && !user.remindersEnabled) { fail("Erinnerungen abgeschaltet"); continue; }
      if (row.type === "price_change" && !user.priceMailsEnabled) { fail("Preis-Infos abgeschaltet"); continue; }
      if (row.type === "verify_email" && user.email !== row.toAddress) { fail("Adresse wurde inzwischen geändert"); continue; }
    }
    try {
      await transport.send({ to: row.toAddress, subject: row.subject, text: row.bodyText, unsubscribeUrl: row.unsubscribeUrl });
      db.update(mailOutbox).set({ status: "sent", sentAt: now.toISOString(), attempts: row.attempts + 1, lastError: null, bodyText: "", toAddress: null }).where(eq(mailOutbox.id, row.id)).run();
      result.sent++;
    } catch (err) {
      const attempts = row.attempts + 1;
      if (attempts >= MAX_ATTEMPTS) {
        db.update(mailOutbox).set({ status: "failed", attempts, lastError: safeError(err), bodyText: "", toAddress: null }).where(eq(mailOutbox.id, row.id)).run();
        result.failed++;
      } else {
        const wait = BACKOFF_MINUTES[Math.min(attempts - 1, BACKOFF_MINUTES.length - 1)]! * 60_000;
        db.update(mailOutbox).set({ attempts, lastError: safeError(err), nextAttemptAt: new Date(now.getTime() + wait).toISOString() }).where(eq(mailOutbox.id, row.id)).run();
        result.retried++;
      }
    }
  }
  return result;
}

/** Räumt erledigte Einträge nach 60 Tagen auf (verschickte/fehlgeschlagene Mails, alte Bestätigungslinks). */
export function purgeOldMail(db: Db, now: Date = new Date()): void {
  const cutoff = new Date(now.getTime() - RETENTION_DAYS * 24 * 3600 * 1000).toISOString();
  db.delete(mailOutbox).where(and(inArray(mailOutbox.status, ["sent", "failed"]), lt(mailOutbox.createdAt, cutoff))).run();
  db.delete(emailVerifications).where(lt(emailVerifications.createdAt, cutoff)).run();
}
