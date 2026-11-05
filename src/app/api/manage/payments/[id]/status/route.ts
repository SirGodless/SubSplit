import { z } from "zod";
import { ctx } from "@/lib/server/context";
import { intParam, json, userRoute } from "@/lib/server/http";
import { setStatusByOwner } from "@/lib/services/payments";

export const dynamic = "force-dynamic";

const body = z.object({ status: z.enum(["open", "marked_paid", "confirmed"]) });

export const POST = userRoute<{ id: string }>(async ({ user, params, readBody }) => {
  const { status } = body.parse(await readBody());
  return setStatusByOwner(ctx().db, user.id, intParam(params.id), status) ? { ok: true } : json({ error: "not_found" }, 404);
});
