import { z } from "zod";
import { ctx } from "@/lib/server/context";
import { adminRoute } from "@/lib/server/http";
import { endMembership } from "@/lib/services/admin";

export const dynamic = "force-dynamic";

const body = z.object({
  subscriptionId: z.number().int(),
  participantId: z.number().int(),
  lastMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
});

export const POST = adminRoute(async ({ readBody }) => {
  endMembership(ctx().db, body.parse(await readBody()));
  return { ok: true };
});
