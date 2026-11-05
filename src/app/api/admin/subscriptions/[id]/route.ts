import { ctx } from "@/lib/server/context";
import { adminRoute } from "@/lib/server/http";
import { deleteSubscription } from "@/lib/services/admin";

export const dynamic = "force-dynamic";

export const DELETE = adminRoute<{ id: string }>(({ params }) => {
  deleteSubscription(ctx().db, Number(params.id));
  return { ok: true };
});
