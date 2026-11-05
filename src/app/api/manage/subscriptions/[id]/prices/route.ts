import { z } from "zod";
import { ctx } from "@/lib/server/context";
import { intParam, userRoute } from "@/lib/server/http";
import { setPrice } from "@/lib/services/manage";

export const dynamic = "force-dynamic";

const body = z.object({ validFromMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), priceCents: z.number().int() });

export const POST = userRoute<{ id: string }>(async ({ user, params, readBody }) => {
  const input = body.parse(await readBody());
  setPrice(ctx().db, user.id, intParam(params.id), input.validFromMonth, input.priceCents);
  return { ok: true };
});
