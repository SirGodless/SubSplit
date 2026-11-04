import { eq } from "drizzle-orm";
import { participants, payments } from "@/db/schema";
import { currentMonth } from "@/lib/billing/month";
import { ctx } from "@/lib/server/context";
import { adminRoute } from "@/lib/server/http";
import { ensureMonthPayments } from "@/lib/services/payments";

export const dynamic = "force-dynamic";

/** Monatsübersicht für den Admin: wer ist offen, wer hat bezahlt. Enthält alles (Admin sieht alles). */
export const GET = adminRoute(({ req }) => {
  const { db } = ctx();
  const month = new URL(req.url).searchParams.get("month") ?? currentMonth();
  const result = ensureMonthPayments(db, month);
  const rows = db
    .select({
      paymentId: payments.id,
      participantId: participants.id,
      displayName: participants.displayName,
      email: participants.email,
      referenceId: payments.referenceId,
      amountCents: payments.amountCents,
      status: payments.status,
      markedPaidAt: payments.markedPaidAt,
      confirmedAt: payments.confirmedAt,
    })
    .from(payments)
    .innerJoin(participants, eq(participants.id, payments.participantId))
    .where(eq(payments.month, month))
    .all();
  const owner = result.totals.find((t) => t.isOwner);
  return {
    month,
    payments: rows,
    ownerShareCents: owner?.totalCents ?? 0,
    subscriptions: result.subscriptions,
    totals: { open: rows.filter((r) => r.status === "open").length, markedPaid: rows.filter((r) => r.status === "marked_paid").length, confirmed: rows.filter((r) => r.status === "confirmed").length },
  };
});
