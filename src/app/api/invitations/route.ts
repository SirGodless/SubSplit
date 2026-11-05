import { ctx } from "@/lib/server/context";
import { userRoute } from "@/lib/server/http";
import { createInvitation, listInvitations } from "@/lib/services/invitations";

export const dynamic = "force-dynamic";

export const GET = userRoute(({ user }) => listInvitations(ctx().db, user, ctx().config.invite));

/** Neuer Einladungslink (7 Tage gültig, höchstens 5 offene). Der Link wird nur jetzt angezeigt. */
export const POST = userRoute(({ user }) => {
  const { db, config } = ctx();
  return { link: `${config.baseUrl}/invite/${createInvitation(db, user, config.invite)}` };
});
