import { z } from "zod";
import { ctx } from "@/lib/server/context";
import { userRoute } from "@/lib/server/http";
import { setStandingOrder } from "@/lib/services/standing-orders";

export const dynamic = "force-dynamic";

const body = z.object({
  payerUserId: z.number().int(),
  recipientUserId: z.number().int(),
  /** Startmonat; null schaltet den Dauerauftrag aus. */
  fromMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).nullable(),
});

/** Dauerauftrag ein-/ausschalten. Erlaubt für den Zahler selbst und für den Empfänger (Vertrauensbasis), sonst 404. */
export const POST = userRoute(async ({ user, readBody }) => {
  setStandingOrder(ctx().db, user.id, body.parse(await readBody()));
  return { ok: true };
});
