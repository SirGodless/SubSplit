import { z } from "zod";
import { ctx, kickMail, mailCtx } from "@/lib/server/context";
import { intParam, userRoute } from "@/lib/server/http";
import { setPriceAndNotify } from "@/lib/services/notify";

export const dynamic = "force-dynamic";

const body = z.object({ validFromMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), priceCents: z.number().int() });

export const POST = userRoute<{ id: string }>(async ({ user, params, readBody }) => {
  const input = body.parse(await readBody());
  const queued = setPriceAndNotify(ctx().db, mailCtx(), user.id, intParam(params.id), input.validFromMonth, input.priceCents);
  if (queued > 0) kickMail();
  return { ok: true, notified: queued };
});
