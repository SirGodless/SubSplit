import { buildPaymentLinks } from "@/lib/pay/links";
import { ctx } from "@/lib/server/context";
import { clientIp } from "@/lib/server/context";
import { errorResponse, json, notFound } from "@/lib/server/http";
import { authenticateToken, getParticipantView } from "@/lib/services/participant-view";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const c = ctx();
    const ip = clientIp(req.headers);
    if (!c.tokenLimiter.consume(ip)) return json({ error: "rate_limited" }, 429, { "Retry-After": "60" });

    const auth = authenticateToken(c.db, token, ip, c.logger);
    if (auth.kind !== "ok") return notFound(); // unbekannt und widerrufen sehen für den Client gleich aus

    const month = new URL(req.url).searchParams.get("month") ?? undefined;
    const view = getParticipantView(c.db, auth.participantId, month);
    if (!view) return notFound();

    const links =
      view.payment && view.payment.status !== "confirmed"
        ? await buildPaymentLinks(
            { name: c.config.recipientName, paypalMe: c.config.recipientPaypalMe, iban: c.config.recipientIban, appName: c.config.appName, paypalFormat: c.config.paypalFormat },
            { referenceId: view.payment.referenceId, month: view.month, amountCents: view.payment.amountCents },
          )
        : null;
    return json({ view, links });
  } catch (err) {
    return errorResponse(err);
  }
}
