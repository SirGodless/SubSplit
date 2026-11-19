import { clearSessionCookie, SESSION_COOKIE } from "@/lib/security/session";
import { ctx, secureCookies } from "@/lib/server/context";
import { json, readCookie, userRoute } from "@/lib/server/http";
import { deleteSessionByToken } from "@/lib/services/sessions";

export const dynamic = "force-dynamic";

/**
 * Beendet nur die Sitzung in SubSplit. Im Hub bleibt man angemeldet (Einmal-Anmeldung): Wer überall abmelden will, tut das
 * im Hub, und der Hub meldet dann auch hier ab (Back-Channel-Logout).
 */
export const POST = userRoute(({ req }) => {
  deleteSessionByToken(ctx().db, readCookie(req, SESSION_COOKIE));
  return json({ ok: true }, 200, { "Set-Cookie": clearSessionCookie(secureCookies()) });
});
