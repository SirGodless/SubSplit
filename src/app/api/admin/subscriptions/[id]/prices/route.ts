import { z } from "zod";
import { ctx } from "@/lib/server/context";
import { adminRoute } from "@/lib/server/http";
import { setPrice } from "@/lib/services/admin";

export const dynamic = "force-dynamic";

const body = z.object({ validFromMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), priceCents: z.number().int() });

export const POST = adminRoute<{ id: string }>(async ({ params, readBody }) => {
  const input = body.parse(await readBody());
  setPrice(ctx().db, Number(params.id), input.validFromMonth, input.priceCents);
  return { ok: true };
});
