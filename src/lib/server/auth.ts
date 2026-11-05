import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySession, type SessionPayload } from "@/lib/security/session";
import { getSessionUser, type UserRow } from "@/lib/services/users";
import { ctx } from "./context";

/** Angemeldetes Konto für Server-Komponenten (null, wenn nicht angemeldet, gesperrt oder Sitzung abgelaufen). */
export async function getPageUser(): Promise<{ user: UserRow; session: SessionPayload } | null> {
  const c = ctx();
  const session = verifySession((await cookies()).get(SESSION_COOKIE)?.value, c.config.sessionSecret);
  const user = session ? getSessionUser(c.db, session.uid, session.sv) : null;
  return session && user ? { user, session } : null;
}
