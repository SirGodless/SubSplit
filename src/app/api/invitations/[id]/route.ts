import { ctx } from "@/lib/server/context";
import { intParam, userRoute } from "@/lib/server/http";
import { revokeInvitation } from "@/lib/services/invitations";

export const dynamic = "force-dynamic";

export const DELETE = userRoute<{ id: string }>(({ user, params }) => {
  revokeInvitation(ctx().db, user.id, intParam(params.id));
  return { ok: true };
});
