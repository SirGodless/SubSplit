import { z } from "zod";
import { ctx } from "@/lib/server/context";
import { intParam, userRoute } from "@/lib/server/http";
import { setDisabled } from "@/lib/services/users";

export const dynamic = "force-dynamic";

const body = z.object({ disabled: z.boolean() });

export const POST = userRoute<{ id: string }>(async ({ user, params, readBody }) => {
  setDisabled(ctx().db, intParam(params.id), body.parse(await readBody()).disabled, user.id);
  return { ok: true };
}, { operator: true });
