import { ctx } from "@/lib/server/context";
import { userRoute } from "@/lib/server/http";
import { getOwnerOverview } from "@/lib/services/views";

export const dynamic = "force-dynamic";

export const GET = userRoute(({ req, user }) => getOwnerOverview(ctx().db, user.id, new URL(req.url).searchParams.get("month") ?? undefined));
