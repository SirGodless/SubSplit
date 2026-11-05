import { z } from "zod";
import { ctx } from "@/lib/server/context";
import { intParam, json, notFound, userRoute } from "@/lib/server/http";
import { setPaidByPayer } from "@/lib/services/payments";

export const dynamic = "force-dynamic";

const body = z.object({ paid: z.boolean() });

export const POST = userRoute<{ recipientId: string }>(async ({ user, params, readBody }) => {
  const { paid } = body.parse(await readBody());
  const result = setPaidByPayer(ctx().db, user.id, intParam(params.recipientId), paid);
  if (result === "not_found") return notFound();
  if (result === "locked") return json({ error: "locked", message: "Diese Zahlung ist bereits bestätigt." }, 409);
  return { ok: true };
});
