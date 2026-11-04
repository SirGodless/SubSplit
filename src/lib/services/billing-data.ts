import type { Db } from "@/db/client";
import { memberships, participants, subscriptionPrices, subscriptions } from "@/db/schema";
import type { ParticipantInput, SubscriptionInput } from "@/lib/billing/compute";

/** Lädt nur die für die Berechnung nötigen Felder (keine E-Mail, keine Token). */
export function loadBillingInput(db: Db): { subscriptions: SubscriptionInput[]; participants: ParticipantInput[] } {
  const subs = db.select({ id: subscriptions.id, name: subscriptions.name }).from(subscriptions).all();
  const prices = db.select().from(subscriptionPrices).all();
  const ms = db.select().from(memberships).all();
  const ps = db.select({ id: participants.id, displayName: participants.displayName, isOwner: participants.isOwner }).from(participants).all();
  return {
    subscriptions: subs.map((s) => ({
      id: s.id,
      name: s.name,
      prices: prices.filter((p) => p.subscriptionId === s.id).map((p) => ({ validFromMonth: p.validFromMonth, amountCents: p.amountCents })),
      memberships: ms
        .filter((m) => m.subscriptionId === s.id)
        .map((m) => ({ participantId: m.participantId, weight: m.weight, validFromMonth: m.validFromMonth, validToMonth: m.validToMonth })),
    })),
    participants: ps,
  };
}
