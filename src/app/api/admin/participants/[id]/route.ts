import { z } from "zod";
import { ctx } from "@/lib/server/context";
import { adminRoute } from "@/lib/server/http";
import { updateParticipant } from "@/lib/services/admin";

export const dynamic = "force-dynamic";

const patch = z.object({ displayName: z.string().optional(), email: z.string().nullable().optional(), remindersEnabled: z.boolean().optional() });

export const PATCH = adminRoute<{ id: string }>(async ({ params, readBody }) => {
  updateParticipant(ctx().db, Number(params.id), patch.parse(await readBody()));
  return { ok: true };
});
