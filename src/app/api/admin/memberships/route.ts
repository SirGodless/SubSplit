import { z } from "zod";
import { ctx } from "@/lib/server/context";
import { adminRoute } from "@/lib/server/http";
import { setMembership } from "@/lib/services/admin";

export const dynamic = "force-dynamic";

const body = z.object({
  subscriptionId: z.number().int(),
  participantId: z.number().int(),
  weight: z.number().int(),
  from: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
});

export const PUT = adminRoute(async ({ readBody }) => {
  setMembership(ctx().db, body.parse(await readBody()));
  return { ok: true };
});
