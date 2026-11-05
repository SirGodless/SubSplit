import { z } from "zod";
import { isSameOrigin } from "@/lib/security/csrf";
import { createSession, sessionCookie } from "@/lib/security/session";
import { clientIp, ctx, secureCookies } from "@/lib/server/context";
import { errorResponse, json, notFound, readJson } from "@/lib/server/http";
import { acceptInvitation, peekInvitation } from "@/lib/services/invitations";

export const dynamic = "force-dynamic";

const body = z.object({ username: z.string().max(100), displayName: z.string().max(200), password: z.string().max(200) });

/** Einladungslink einlösen: eigenes Konto anlegen und gleich angemeldet sein. */
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const c = ctx();
    const ip = clientIp(req.headers);
    if (!c.tokenLimiter.consume(ip)) return json({ error: "rate_limited" }, 429, { "Retry-After": "60" });
    if (!isSameOrigin(req.headers.get("origin"), c.config.baseUrl)) return json({ error: "forbidden" }, 403);
    if (!peekInvitation(c.db, token, ip, c.logger, c.config.invite)) return notFound();
    const { userId, sessionVersion } = acceptInvitation(c.db, token, body.parse(await readJson(req)), c.config.invite);
    const { value, payload } = createSession(c.config.sessionSecret, { uid: userId, sv: sessionVersion }, Date.now(), c.config.idleSeconds);
    return json({ csrfToken: payload.csrf }, 200, { "Set-Cookie": sessionCookie(value, secureCookies(), c.config.idleSeconds) });
  } catch (err) {
    return errorResponse(err);
  }
}
