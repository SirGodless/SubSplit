import { isSameOrigin } from "@/lib/security/csrf";
import { clientIp, ctx } from "@/lib/server/context";
import { errorResponse, json, notFound } from "@/lib/server/http";
import { confirmEmailVerification, peekEmailVerification } from "@/lib/services/email";

export const dynamic = "force-dynamic";

/** Bestätigt die E-Mail-Adresse über den Link aus der Mail (der Link selbst ist das Geheimnis, keine Anmeldung nötig). */
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const c = ctx();
    const ip = clientIp(req.headers);
    if (!c.tokenLimiter.consume(ip)) return json({ error: "rate_limited" }, 429, { "Retry-After": "60" });
    if (!isSameOrigin(req.headers.get("origin"), c.config.baseUrl)) return json({ error: "forbidden" }, 403);
    if (!peekEmailVerification(c.db, token, ip, c.logger)) return notFound();
    confirmEmailVerification(c.db, token);
    return json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
