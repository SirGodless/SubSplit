import { ctx } from "@/lib/server/context";
import { userRoute } from "@/lib/server/http";
import { listDirectory } from "@/lib/services/users";

export const dynamic = "force-dynamic";

/** Konten, die sich als Mitzahler eintragen lassen (nur Anzeigename und Benutzername). */
export const GET = userRoute(() => ({ users: listDirectory(ctx().db) }));
