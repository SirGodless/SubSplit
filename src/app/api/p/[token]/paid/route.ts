import { z } from "zod";
import { isSameOrigin } from "@/lib/security/csrf";
import { clientIp, ctx } from "@/lib/server/context";
import { errorResponse, json, notFound, readJson } from "@/lib/server/http";
import { setPaidByParticipant } from "@/lib/services/payments";
import { authenticateToken } from "@/lib/services/participant-view";

export const dynamic = "force-dynamic";

const body = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), paid: z.boolean() });

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const c = ctx();
    const ip = clientIp(req.headers);
    if (!c.tokenLimiter.consume(ip)) return json({ error: "rate_limited" }, 429, { "Retry-After": "60" });
    if (!isSameOrigin(req.headers.get("origin"), c.config.baseUrl)) return json({ error: "forbidden" }, 403);

    const auth = authenticateToken(c.db, token, ip, c.logger);
    if (auth.kind !== "ok") return notFound();

    const input = body.parse(await readJson(req));
    const result = setPaidByParticipant(c.db, auth.participantId, input.month, input.paid);
    if (result === "not_found") return notFound();
    if (result === "locked") return json({ error: "locked" }, 409);
    return json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
