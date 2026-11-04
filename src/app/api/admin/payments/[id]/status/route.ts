import { z } from "zod";
import { ctx } from "@/lib/server/context";
import { adminRoute, json } from "@/lib/server/http";
import { setStatusByAdmin } from "@/lib/services/payments";

export const dynamic = "force-dynamic";

const body = z.object({ status: z.enum(["open", "marked_paid", "confirmed"]) });

export const POST = adminRoute<{ id: string }>(async ({ params, readBody }) => {
  const { status } = body.parse(await readBody());
  return setStatusByAdmin(ctx().db, Number(params.id), status) ? { ok: true } : json({ error: "not_found" }, 404);
});
