import { HubError } from "@/lib/hub/oidc";
import { ctx } from "@/lib/server/context";
import { deleteSessionsByHubSid, deleteSessionsOfSub } from "@/lib/services/sessions";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/** Schon gesehene jti des Hubs (ein Logout-Token gilt nur einmal). Reicht im Arbeitsspeicher: Die Tokens leben nur 2 Minuten. */
const seen = new Map<string, number>();

/**
 * Back-Channel-Logout: Meldet sich jemand im Hub ab (oder wird gesperrt), schickt der Hub hierher ein signiertes Logout-Token.
 * Mit sid enden nur die Sitzungen aus dieser Hub-Sitzung, ohne sid alle Sitzungen des Nutzers. Kein Cookie, keine CSRF-Prüfung:
 * Der Aufruf kommt vom Hub (Server zu Server) und gilt nur mit gültiger Signatur.
 */
export async function POST(req: Request) {
  const c = ctx();
  try {
    const form = await req.formData();
    const token = form.get("logout_token");
    if (typeof token !== "string" || token.length > 8000) throw new HubError("kein Logout-Token", "invalid");
    const claims = await c.oidc.verifyLogoutToken(token);
    const now = Date.now();
    for (const [jti, exp] of seen) if (exp < now) seen.delete(jti);
    if (seen.has(claims.jti)) throw new HubError("Logout-Token schon benutzt", "invalid");
    seen.set(claims.jti, now + 5 * 60_000);
    const ended = claims.sid ? deleteSessionsByHubSid(c.db, claims.sid) : deleteSessionsOfSub(c.db, claims.sub!);
    console.log(`Logout-Token vom Hub: ${ended} Sitzung(en) beendet.`);
    return new Response(null, { status: 200, headers: NO_STORE });
  } catch (err) {
    console.error("Logout-Token abgelehnt:", err instanceof Error ? err.message : "Fehler");
    return Response.json({ error: "invalid_request" }, { status: 400, headers: NO_STORE });
  }
}
