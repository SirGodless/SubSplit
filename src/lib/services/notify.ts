import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { standingOrders, users } from "@/db/schema";
import { priceChangeMail } from "@/lib/mail/templates";
import { unsubscribeLinks, type MailCtx } from "./email";
import { enqueueMail } from "./mail";
import { ownedSubscription, setPrice } from "./manage";
import { computeOwnerMonth } from "./payments";

/**
 * Preis ändern und die betroffenen Mitzahler per Mail informieren (wenn der Mailversand aktiv ist, `ctx !== null`).
 * Die Mail nennt den alten und neuen Preis, den neuen Anteil und Gesamtbetrag ab dem Gültigkeitsmonat und weist
 * Zahler mit Dauerauftrag darauf hin, ihn anzupassen. Gibt die Zahl der angelegten Mails zurück.
 * Dieselbe Änderung wird nie zweimal gemailt (dedupe_key aus Abo, Monat, neuem Preis und Konto).
 */
export function setPriceAndNotify(
  db: Db,
  ctx: MailCtx | null,
  ownerId: number,
  subscriptionId: number,
  month: string,
  priceCents: number,
  now: Date = new Date(),
): number {
  const sub = ownedSubscription(db, ownerId, subscriptionId);
  const before = computeOwnerMonth(db, ownerId, month);
  setPrice(db, ownerId, subscriptionId, month, priceCents, now);
  if (!ctx) return 0;
  const after = computeOwnerMonth(db, ownerId, month);

  const oldSub = before.subscriptions.find((s) => s.subscriptionId === subscriptionId);
  const newSub = after.subscriptions.find((s) => s.subscriptionId === subscriptionId);
  if (!newSub || (oldSub && oldSub.priceCents === newSub.priceCents)) return 0;
  const owner = db.select({ displayName: users.displayName }).from(users).where(eq(users.id, ownerId)).get();
  if (!owner) return 0;

  let queued = 0;
  for (const line of newSub.lines) {
    if (line.participantId === ownerId) continue;
    const u = db.select().from(users).where(eq(users.id, line.participantId)).get();
    if (!u || u.disabledAt || !u.email || !u.emailVerifiedAt || !u.priceMailsEnabled) continue;
    const oldLine = oldSub?.lines.find((l) => l.participantId === u.id);
    const hasOrder = !!db.select({ id: standingOrders.id }).from(standingOrders).where(and(eq(standingOrders.payerUserId, u.id), eq(standingOrders.recipientUserId, ownerId))).get();
    const links = unsubscribeLinks(ctx, u.id, "prices");
    const m = priceChangeMail({
      appName: ctx.appName,
      name: u.displayName,
      ownerName: owner.displayName,
      subscriptionName: sub.name,
      month,
      oldPriceCents: oldSub?.priceCents ?? null,
      newPriceCents: newSub.priceCents,
      oldShareCents: oldLine?.amountCents ?? null,
      newShareCents: line.amountCents,
      oldTotalCents: before.totals.find((t) => t.participantId === u.id)?.totalCents ?? null,
      newTotalCents: after.totals.find((t) => t.participantId === u.id)?.totalCents ?? line.amountCents,
      hasStandingOrder: hasOrder,
      payLink: `${ctx.baseUrl}/pay/${ownerId}`,
      unsubscribeUrl: links.page,
    });
    const id = enqueueMail(
      db,
      { toUserId: u.id, toAddress: u.email, type: "price_change", dedupeKey: `price:${subscriptionId}:${month}:${newSub.priceCents}:${u.id}`, subject: m.subject, bodyText: m.text, unsubscribeUrl: links.oneClick },
      now,
    );
    if (id !== null) queued++;
  }
  return queued;
}
