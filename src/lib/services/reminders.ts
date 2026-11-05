import { and, asc, eq, like, lte } from "drizzle-orm";
import type { Db } from "@/db/client";
import { mailOutbox, payments, standingOrders, users } from "@/db/schema";
import type { ReminderSettings } from "@/lib/config";
import { addDays, berlinDate, currentMonth, dueDateOf, inSendWindow } from "@/lib/billing/month";
import { reminderMail } from "@/lib/mail/templates";
import { unsubscribeLinks, type MailCtx } from "./email";
import { enqueueMail } from "./mail";
import { ensureAllOwnerPayments } from "./payments";

/**
 * Legt fällige Zahlungserinnerungen im Postausgang an (nur zwischen 8 und 20 Uhr Berlin). Regeln:
 *  - Pro Zahler und Empfänger höchstens eine Mail, mit dem Gesamtbetrag (laufender Monat plus Rückstand).
 *  - Auslöser ist die NEUESTE offene Zahlung. Die erste Erinnerung geht `firstDaysAfterDue` Tage nach deren
 *    Fälligkeitstag raus, danach frühestens alle `repeatDays` Tage, höchstens `maxPerPayment` pro Zahlung.
 *  - Keine Mail bei bezahlt gemeldeten/bestätigten Zahlungen und bei Monaten, die ein Dauerauftrag abdeckt.
 *  - Nur an bestätigte Adressen aktiver Konten, die Erinnerungen nicht abgeschaltet haben.
 * Über den dedupe_key ist ein Doppelversand (auch nach Neustart) ausgeschlossen.
 */
export function enqueueDueReminders(db: Db, ctx: MailCtx & { settings: ReminderSettings }, now: Date = new Date()): number {
  ensureAllOwnerPayments(db, now); // Zahlungen entstehen sonst erst beim Aufruf der App
  if (!inSendWindow(now)) return 0;
  const today = berlinDate(now);
  const cur = currentMonth(now);
  const open = db
    .select()
    .from(payments)
    .where(and(eq(payments.status, "open"), lte(payments.month, cur)))
    .orderBy(asc(payments.month))
    .all();
  if (open.length === 0) return 0;

  const orders = new Map(db.select().from(standingOrders).all().map((o) => [`${o.payerUserId}:${o.recipientUserId}`, o.fromMonth]));
  const groups = new Map<string, typeof open>();
  for (const p of open) {
    const key = `${p.payerUserId}:${p.recipientUserId}`;
    const so = orders.get(key);
    if (so !== undefined && p.month >= so) continue; // vom Dauerauftrag abgedeckt
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }

  const userCache = new Map<number, typeof users.$inferSelect | undefined>();
  const getUser = (id: number) => {
    if (!userCache.has(id)) userCache.set(id, db.select().from(users).where(eq(users.id, id)).get());
    return userCache.get(id);
  };

  let queued = 0;
  for (const rows of groups.values()) {
    const trigger = rows[rows.length - 1]!;
    const payer = getUser(trigger.payerUserId);
    const owner = getUser(trigger.recipientUserId);
    if (!payer || !owner || payer.disabledAt || !payer.email || !payer.emailVerifiedAt || !payer.remindersEnabled) continue;

    const due = dueDateOf(trigger.month, owner.dueDay);
    if (today < addDays(due, ctx.settings.firstDaysAfterDue)) continue;

    const sent = db
      .select({ createdAt: mailOutbox.createdAt })
      .from(mailOutbox)
      .where(and(eq(mailOutbox.type, "reminder"), like(mailOutbox.dedupeKey, `reminder:${trigger.id}:%`)))
      .orderBy(asc(mailOutbox.id))
      .all();
    if (sent.length >= ctx.settings.maxPerPayment) continue;
    if (sent.length > 0 && today < addDays(berlinDate(new Date(sent[sent.length - 1]!.createdAt)), ctx.settings.repeatDays)) continue;

    const links = unsubscribeLinks(ctx, payer.id, "reminders");
    const m = reminderMail({
      appName: ctx.appName,
      name: payer.displayName,
      recipientName: owner.displayName,
      totalCents: rows.reduce((s, r) => s + r.amountCents, 0),
      items: rows.map((r) => ({ month: r.month, amountCents: r.amountCents })),
      referenceId: trigger.referenceId,
      dueDate: due,
      payLink: `${ctx.baseUrl}/pay/${owner.id}`,
      unsubscribeUrl: links.page,
    });
    const id = enqueueMail(
      db,
      { toUserId: payer.id, toAddress: payer.email, type: "reminder", dedupeKey: `reminder:${trigger.id}:${sent.length + 1}`, subject: m.subject, bodyText: m.text, unsubscribeUrl: links.oneClick },
      now,
    );
    if (id !== null) queued++;
  }
  return queued;
}
