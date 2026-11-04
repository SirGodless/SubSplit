import { z } from "zod";
import { ctx } from "@/lib/server/context";
import { adminRoute } from "@/lib/server/http";
import { regenerateToken, revokeToken } from "@/lib/services/admin";

export const dynamic = "force-dynamic";

const body = z.object({ action: z.enum(["regenerate", "revoke"]) });

export const POST = adminRoute<{ id: string }>(async ({ params, readBody }) => {
  const c = ctx();
  const { action } = body.parse(await readBody());
  const id = Number(params.id);
  if (action === "revoke") {
    revokeToken(c.db, id);
    return { ok: true };
  }
  return { link: `${c.config.baseUrl}/p/${regenerateToken(c.db, id)}` };
});
