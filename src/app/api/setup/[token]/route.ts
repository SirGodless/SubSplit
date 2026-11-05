import { z } from "zod";
import { isSameOrigin } from "@/lib/security/csrf";
import { createSession, sessionCookie } from "@/lib/security/session";
import { clientIp, ctx, secureCookies } from "@/lib/server/context";
import { errorResponse, json, notFound, readJson } from "@/lib/server/http";
import { completeSetup, peekSetupToken } from "@/lib/services/users";

export const dynamic = "force-dynamic";

const body = z.object({ password: z.string().max(200) });

/** Einrichtungslink einlösen: Passwort setzen und gleich angemeldet sein. */
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const c = ctx();
    const ip = clientIp(req.headers);
    if (!c.tokenLimiter.consume(ip)) return json({ error: "rate_limited" }, 429, { "Retry-After": "60" });
    if (!isSameOrigin(req.headers.get("origin"), c.config.baseUrl)) return json({ error: "forbidden" }, 403);
    if (peekSetupToken(c.db, token, ip, c.logger).kind !== "ok") return notFound();
    const { userId, sessionVersion } = completeSetup(c.db, token, body.parse(await readJson(req)).password);
    const { value, payload } = createSession(c.config.sessionSecret, { uid: userId, sv: sessionVersion }, Date.now(), c.config.idleSeconds);
    return json({ csrfToken: payload.csrf }, 200, { "Set-Cookie": sessionCookie(value, secureCookies(), c.config.idleSeconds) });
  } catch (err) {
    return errorResponse(err);
  }
}
