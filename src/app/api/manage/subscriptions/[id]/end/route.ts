import { z } from "zod";
import { ctx } from "@/lib/server/context";
import { intParam, userRoute } from "@/lib/server/http";
import { endSubscription } from "@/lib/services/manage";

export const dynamic = "force-dynamic";

const body = z.object({ lastMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) });

export const POST = userRoute<{ id: string }>(async ({ user, params, readBody }) => {
  endSubscription(ctx().db, user.id, intParam(params.id), body.parse(await readBody()).lastMonth);
  return { ok: true };
});
