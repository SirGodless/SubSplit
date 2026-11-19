import { HubError } from "@/lib/hub/oidc";
import { safeNextPath } from "@/lib/nav";
import { clearOidcCookie, OIDC_COOKIE, readOidcCookie, sessionCookie } from "@/lib/security/session";
import { safeEqual } from "@/lib/security/tokens";
import { clientIp, ctx, secureCookies } from "@/lib/server/context";
import { readCookie } from "@/lib/server/http";
import { createSession } from "@/lib/services/sessions";
import { ensureUser, markLogin } from "@/lib/services/users";

export const dynamic = "force-dynamic";

/** Rücksprung vom Hub mit dem Code: tauschen, ID-Token prüfen, Zugang und Rechte lesen, Sitzung anlegen. */
export async function GET(req: Request) {
  const c = ctx();
  const secure = secureCookies();
  const fail = (error: string) => {
    const h = new Headers({ Location: `${c.config.baseUrl}/login?error=${error}`, "Cache-Control": "no-store" });
    h.append("Set-Cookie", clearOidcCookie(secure));
    return new Response(null, { status: 302, headers: h });
  };
  const ip = clientIp(req.headers);
  if (!c.loginLimiter.consume(ip)) return fail("rate_limited");

  const q = new URL(req.url).searchParams;
  const flow = readOidcCookie(readCookie(req, OIDC_COOKIE), c.config.sessionSecret);
  const state = q.get("state");
  if (!flow || !state || !safeEqual(state, flow.state)) {
    c.logger.authFail(ip, "oidc_state");
    return fail("state");
  }
  const code = q.get("code");
  if (q.get("error") || !code) return fail("denied");

  try {
    const login = await c.oidc.exchangeCode(code, flow.verifier, `${c.config.baseUrl}/auth/callback`, flow.nonce);
    const { access, operator } = await c.hub.isOperator(login.sub);
    if (!access) return fail("no_access");
    const user = ensureUser(c.db, login.sub);
    markLogin(c.db, user.id);
    const { token } = createSession(c.db, { userId: user.id, hubSid: login.sid, refreshToken: login.refreshToken, operator }, c.config.idleSeconds);
    const headers = new Headers({ Location: `${c.config.baseUrl}${safeNextPath(flow.next) ?? "/"}`, "Cache-Control": "no-store" });
    headers.append("Set-Cookie", sessionCookie(token, secure, c.config.idleSeconds));
    headers.append("Set-Cookie", clearOidcCookie(secure));
    return new Response(null, { status: 302, headers });
  } catch (err) {
    if (err instanceof HubError && err.kind === "unavailable") return fail("hub_unavailable");
    c.logger.authFail(ip, "oidc_login");
    console.error("Anmeldung fehlgeschlagen:", err instanceof Error ? err.message : "Fehler");
    return fail("failed");
  }
}
