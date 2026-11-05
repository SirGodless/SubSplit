import { z } from "zod";
import { ctx } from "@/lib/server/context";
import { adminRoute } from "@/lib/server/http";
import { endSubscription } from "@/lib/services/admin";

export const dynamic = "force-dynamic";

const body = z.object({ lastMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) });

export const POST = adminRoute<{ id: string }>(async ({ params, readBody }) => {
  endSubscription(ctx().db, Number(params.id), body.parse(await readBody()).lastMonth);
  return { ok: true };
});
