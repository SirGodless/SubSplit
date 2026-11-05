import { buildPaymentLinks } from "@/lib/pay/links";
import { ctx } from "@/lib/server/context";
import { intParam, json, notFound, userRoute } from "@/lib/server/http";
import { getPayerView } from "@/lib/services/views";

export const dynamic = "force-dynamic";

export const GET = userRoute<{ recipientId: string }>(async ({ req, user, params }) => {
  const c = ctx();
  const month = new URL(req.url).searchParams.get("month") ?? undefined;
  const view = getPayerView(c.db, user.id, intParam(params.recipientId), month);
  if (!view) return notFound();
  const o = view.outstanding;
  const links =
    o.totalCents > 0 && o.referenceId && o.referenceMonth && (view.recipientPay.iban || view.recipientPay.paypalMe)
      ? await buildPaymentLinks(
          { name: view.recipientPay.name, paypalMe: view.recipientPay.paypalMe, iban: view.recipientPay.iban, appName: c.config.appName, paypalFormat: c.config.paypalFormat },
          { referenceId: o.referenceId, month: o.referenceMonth, amountCents: o.totalCents, withArrears: o.hasArrears },
        )
      : null;
  return json({ view, links });
});
