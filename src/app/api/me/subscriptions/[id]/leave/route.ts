import { ctx } from "@/lib/server/context";
import { intParam, userRoute } from "@/lib/server/http";
import { leaveSubscription } from "@/lib/services/views";

export const dynamic = "force-dynamic";

export const POST = userRoute<{ id: string }>(({ user, params }) => leaveSubscription(ctx().db, user.id, intParam(params.id)));
