import { z } from "zod";
import { createSession, sessionCookie } from "@/lib/security/session";
import { ctx, secureCookies } from "@/lib/server/context";
import { json, userRoute } from "@/lib/server/http";
import { changePassword } from "@/lib/services/users";

export const dynamic = "force-dynamic";

const body = z.object({ current: z.string().max(500), next: z.string().max(200) });

/** Passwortwechsel beendet alle anderen Sitzungen; diese bekommt sofort eine neue. */
export const POST = userRoute(async ({ user, readBody }) => {
  const c = ctx();
  const input = body.parse(await readBody());
  const sv = changePassword(c.db, user.id, input.current, input.next);
  const { value, payload } = createSession(c.config.sessionSecret, { uid: user.id, sv }, Date.now(), c.config.idleSeconds);
  return json({ csrfToken: payload.csrf }, 200, { "Set-Cookie": sessionCookie(value, secureCookies(), c.config.idleSeconds) });
});
