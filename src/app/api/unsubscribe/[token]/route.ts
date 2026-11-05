import { clientIp, ctx } from "@/lib/server/context";
import { errorResponse, json, notFound } from "@/lib/server/http";
import { applyUnsubscribe } from "@/lib/services/email";

export const dynamic = "force-dynamic";

/**
 * Abmelden von einer Art Mails. Auch der One-Click-Aufruf des Mailprogramms (List-Unsubscribe-Post) landet hier; der
 * signierte Token ist das Geheimnis, deshalb ohne Anmeldung. Ein ungültiger Token ergibt 404 (kein AUTHFAIL: Mailprogramme
 * und Link-Scanner rufen solche Adressen automatisch auf, das darf niemanden sperren).
 */
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const c = ctx();
    if (!c.tokenLimiter.consume(clientIp(req.headers))) return json({ error: "rate_limited" }, 429, { "Retry-After": "60" });
    const done = applyUnsubscribe(c.db, c.config.sessionSecret, token);
    return done ? json({ ok: true, purpose: done.purpose }) : notFound();
  } catch (err) {
    return errorResponse(err);
  }
}
