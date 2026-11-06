import { ctx } from "@/lib/server/context";
import { userRoute } from "@/lib/server/http";
import { includeNewMembersInCurrentMonth } from "@/lib/services/manage";

export const dynamic = "force-dynamic";

/** Zieht neu eingetragene Mitzahler in den laufenden Monat vor (nur offene Zahlungen werden angepasst). */
export const POST = userRoute(async ({ user }) => includeNewMembersInCurrentMonth(ctx().db, user.id));
