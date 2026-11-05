import { z } from "zod";
import { ctx } from "@/lib/server/context";
import { userRoute } from "@/lib/server/http";
import { setNotificationPrefs } from "@/lib/services/email";

export const dynamic = "force-dynamic";

const body = z.object({ remindersEnabled: z.boolean().optional(), priceMailsEnabled: z.boolean().optional() });

export const PATCH = userRoute(async ({ user, readBody }) => {
  setNotificationPrefs(ctx().db, user.id, body.parse(await readBody()));
  return { ok: true };
});
