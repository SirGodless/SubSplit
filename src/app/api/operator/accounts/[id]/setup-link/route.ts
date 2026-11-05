import { ctx } from "@/lib/server/context";
import { intParam, userRoute } from "@/lib/server/http";
import { createSetupLink } from "@/lib/services/users";

export const dynamic = "force-dynamic";

/** Neuer Einrichtungslink (Einladung erneuern oder Passwort zurücksetzen). Ein alter Link wird ungültig. */
export const POST = userRoute<{ id: string }>(({ params }) => {
  const { db, config } = ctx();
  return { link: `${config.baseUrl}/setup/${createSetupLink(db, intParam(params.id))}` };
}, { operator: true });
