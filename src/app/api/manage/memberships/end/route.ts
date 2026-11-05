import { z } from "zod";
import { ctx } from "@/lib/server/context";
import { userRoute } from "@/lib/server/http";
import { endMembership } from "@/lib/services/manage";

export const dynamic = "force-dynamic";

const body = z.object({ subscriptionId: z.number().int(), userId: z.number().int(), lastMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) });

export const POST = userRoute(async ({ user, readBody }) => {
  endMembership(ctx().db, user.id, body.parse(await readBody()));
  return { ok: true };
});
