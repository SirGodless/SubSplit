import { z } from "zod";
import { ctx } from "@/lib/server/context";
import { intParam, userRoute } from "@/lib/server/http";
import { deleteSubscription, renameSubscription } from "@/lib/services/manage";

export const dynamic = "force-dynamic";

export const PATCH = userRoute<{ id: string }>(async ({ user, params, readBody }) => {
  renameSubscription(ctx().db, user.id, intParam(params.id), z.object({ name: z.string().max(200) }).parse(await readBody()).name);
  return { ok: true };
});

export const DELETE = userRoute<{ id: string }>(({ user, params }) => {
  deleteSubscription(ctx().db, user.id, intParam(params.id));
  return { ok: true };
});
