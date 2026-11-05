import { ctx } from "@/lib/server/context";
import { intParam, userRoute } from "@/lib/server/http";
import { reactivateSubscription } from "@/lib/services/manage";

export const dynamic = "force-dynamic";

export const POST = userRoute<{ id: string }>(({ user, params }) => {
  reactivateSubscription(ctx().db, user.id, intParam(params.id));
  return { ok: true };
});
