import { ctx } from "@/lib/server/context";
import { notFound, userRoute } from "@/lib/server/http";
import { getHome } from "@/lib/services/views";

export const dynamic = "force-dynamic";

export const GET = userRoute(({ user }) => getHome(ctx().db, user.id) ?? notFound());
