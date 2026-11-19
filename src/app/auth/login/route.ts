import { randomBytes } from "node:crypto";
import { newPkce } from "@/lib/hub/oidc";
import { safeNextPath } from "@/lib/nav";
import { oidcCookie } from "@/lib/security/session";
import { clientIp, ctx, secureCookies } from "@/lib/server/context";

export const dynamic = "force-dynamic";

/** Startet die Anmeldung beim Hub (OpenID Connect, Authorization Code mit PKCE). Es gibt hier keine Passwortseite. */
export async function GET(req: Request) {
  const c = ctx();
  const to = (path: string, extra: Record<string, string> = {}) => new Response(null, { status: 302, headers: { Location: `${c.config.baseUrl}${path}`, "Cache-Control": "no-store", ...extra } });
  if (!c.loginLimiter.consume(clientIp(req.headers))) return to("/login?error=rate_limited");
  const next = safeNextPath(new URL(req.url).searchParams.get("next"));
  const { verifier, challenge } = newPkce();
  const state = randomBytes(24).toString("base64url");
  const nonce = randomBytes(24).toString("base64url");
  try {
    const location = await c.oidc.authorizeUrl({ redirectUri: `${c.config.baseUrl}/auth/callback`, state, nonce, challenge });
    return new Response(null, {
      status: 302,
      headers: { Location: location, "Cache-Control": "no-store", "Set-Cookie": oidcCookie({ state, nonce, verifier, next }, c.config.sessionSecret, secureCookies()) },
    });
  } catch (err) {
    console.error("Anmeldung nicht möglich:", err instanceof Error ? err.message : "Fehler");
    return to("/login?error=hub_unavailable");
  }
}
