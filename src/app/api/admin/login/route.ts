import { z } from "zod";
import { isSameOrigin } from "@/lib/security/csrf";
import { verifyPassword } from "@/lib/security/password";
import { createSession, sessionCookie } from "@/lib/security/session";
import { safeEqual } from "@/lib/security/tokens";
import { clientIp, ctx } from "@/lib/server/context";
import { errorResponse, json, readJson } from "@/lib/server/http";

export const dynamic = "force-dynamic";

const body = z.object({ username: z.string().max(200), password: z.string().max(500) });

export async function POST(req: Request) {
  try {
    const c = ctx();
    const ip = clientIp(req.headers);
    if (!isSameOrigin(req.headers.get("origin"), c.config.baseUrl)) return json({ error: "forbidden" }, 403);
    if (!c.loginLimiter.consume(ip)) return json({ error: "rate_limited" }, 429, { "Retry-After": "900" });

    const input = body.safeParse(await readJson(req));
    const username = input.success ? input.data.username : "";
    const password = input.success ? input.data.password : "";
    // Passwort immer prüfen (gleiche Laufzeit, egal ob der Benutzername stimmt)
    const passwordOk = verifyPassword(password, c.config.adminPasswordHash);
    const userOk = safeEqual(username, c.config.adminUsername);
    if (!input.success || !passwordOk || !userOk) {
      c.logger.authFail(ip, "admin_login");
      return json({ error: "invalid_credentials" }, 401);
    }
    const { value, payload } = createSession(c.config.sessionSecret);
    return json({ csrfToken: payload.csrf }, 200, { "Set-Cookie": sessionCookie(value, c.config.baseUrl.startsWith("https:")) });
  } catch (err) {
    return errorResponse(err);
  }
}
