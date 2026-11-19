import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/security/session";
import type { SessionRow } from "@/lib/services/sessions";
import { ctx } from "./context";
import { authenticate, type SessionUser } from "./session-auth";

/** Angemeldetes Konto für Server-Komponenten (null, wenn nicht angemeldet, Zugang beim Hub weg oder Sitzung abgelaufen). */
export async function getPageUser(): Promise<{ user: SessionUser; session: SessionRow } | null> {
  const c = ctx();
  return authenticate({ db: c.db, oidc: c.oidc, hub: c.hub, idleSeconds: c.config.idleSeconds }, (await cookies()).get(SESSION_COOKIE)?.value);
}
