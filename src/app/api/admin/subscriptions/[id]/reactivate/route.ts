import { ctx } from "@/lib/server/context";
import { adminRoute } from "@/lib/server/http";
import { reactivateSubscription } from "@/lib/services/admin";

export const dynamic = "force-dynamic";

export const POST = adminRoute<{ id: string }>(({ params }) => {
  reactivateSubscription(ctx().db, Number(params.id));
  return { ok: true };
});
