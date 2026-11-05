import { z } from "zod";
import { ctx } from "@/lib/server/context";
import { userRoute } from "@/lib/server/http";
import { setMembership } from "@/lib/services/manage";

export const dynamic = "force-dynamic";

const body = z.object({ subscriptionId: z.number().int(), userId: z.number().int(), weight: z.number().int(), from: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) });

export const PUT = userRoute(async ({ user, readBody }) => {
  setMembership(ctx().db, user.id, body.parse(await readBody()));
  return { ok: true };
});
