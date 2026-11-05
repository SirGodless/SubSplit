import { z } from "zod";
import { isSameOrigin } from "@/lib/security/csrf";
import { createSession, sessionCookie } from "@/lib/security/session";
import { clientIp, ctx, secureCookies } from "@/lib/server/context";
import { errorResponse, json, readJson } from "@/lib/server/http";
import { authenticate } from "@/lib/services/users";

export const dynamic = "force-dynamic";

const body = z.object({ username: z.string().max(200), password: z.string().max(500) });

export async function POST(req: Request) {
  try {
    const c = ctx();
    const ip = clientIp(req.headers);
    if (!isSameOrigin(req.headers.get("origin"), c.config.baseUrl)) return json({ error: "forbidden" }, 403);
    if (!c.loginLimiter.consume(ip)) return json({ error: "rate_limited" }, 429, { "Retry-After": "900" });

    const input = body.safeParse(await readJson(req));
    const user = input.success ? authenticate(c.db, input.data.username, input.data.password) : null;
    if (!user) {
      c.logger.authFail(ip, "admin_login");
      return json({ error: "invalid_credentials" }, 401);
    }
    const { value, payload } = createSession(c.config.sessionSecret, { uid: user.id, sv: user.sessionVersion }, Date.now(), c.config.idleSeconds);
    return json({ csrfToken: payload.csrf }, 200, { "Set-Cookie": sessionCookie(value, secureCookies(), c.config.idleSeconds) });
  } catch (err) {
    return errorResponse(err);
  }
}
