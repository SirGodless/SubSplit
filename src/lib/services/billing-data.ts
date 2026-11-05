import { eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { memberships, subscriptionPrices, subscriptions, users } from "@/db/schema";
import type { ParticipantInput, SubscriptionInput } from "@/lib/billing/compute";

/**
 * Lädt die Abos EINES Empfängers mit Preisen und Beteiligungen sowie die beteiligten Konten (nur Anzeigename;
 * keine E-Mail, keine Zahlungsdaten).
 */
export function loadBillingInput(db: Db, ownerId: number): { subscriptions: SubscriptionInput[]; participants: ParticipantInput[] } {
  const subs = db.select({ id: subscriptions.id, name: subscriptions.name }).from(subscriptions).where(eq(subscriptions.ownerUserId, ownerId)).all();
  if (subs.length === 0) return { subscriptions: [], participants: [] };
  const ids = subs.map((s) => s.id);
  const prices = db.select().from(subscriptionPrices).where(inArray(subscriptionPrices.subscriptionId, ids)).all();
  const ms = db.select().from(memberships).where(inArray(memberships.subscriptionId, ids)).all();
  const userIds = [...new Set([ownerId, ...ms.map((m) => m.userId)])];
  const ps = db.select({ id: users.id, displayName: users.displayName }).from(users).where(inArray(users.id, userIds)).all();
  return {
    subscriptions: subs.map((s) => ({
      id: s.id,
      name: s.name,
      prices: prices.filter((p) => p.subscriptionId === s.id).map((p) => ({ validFromMonth: p.validFromMonth, amountCents: p.amountCents })),
      memberships: ms
        .filter((m) => m.subscriptionId === s.id)
        .map((m) => ({ participantId: m.userId, weight: m.weight, validFromMonth: m.validFromMonth, validToMonth: m.validToMonth })),
    })),
    participants: ps,
  };
}
