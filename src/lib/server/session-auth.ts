import type { Db } from "@/db/client";
import { HubError } from "@/lib/hub/oidc";
import type { HubApi } from "@/lib/hub/client";
import { identityOf, refreshIdentities } from "@/lib/hub/identity";
import type { HubOidc } from "@/lib/hub/oidc";
import {
  deleteSessionById, findSession, retryHubCheckSoon, slideSession, updateAfterHubCheck, type SessionRow, type UserRow,
} from "@/lib/services/sessions";
import { sessions } from "@/db/schema";
import { eq } from "drizzle-orm";

/** Das angemeldete Konto: lokale Daten plus das, was der Hub über die Person sagt. */
export interface SessionUser extends UserRow {
  /** Benutzername im Hub. */
  username: string;
  /** Zur Anzeige: derselbe Benutzername (der Hub kennt noch keinen eigenen Anzeigenamen). */
  displayName: string;
  email: string | null;
  emailVerified: boolean;
  /** Betreiber ist, wer im Hub das Recht subsplit.operator hat. */
  role: "operator" | "user";
}

export interface Auth {
  user: SessionUser;
  session: SessionRow;
}

interface Deps {
  db: Db;
  oidc: HubOidc;
  hub: HubApi;
  idleSeconds: number;
}

const checks = new Map<string, Promise<boolean>>();

/**
 * Prüft den Zugang einer Sitzung beim Hub, wenn es Zeit dafür ist: Refresh-Token einlösen (das scheitert bei Bann, entzogenem
 * Recht oder beendeter Hub-Sitzung) und das Recht "Betreiber" neu lesen. Gleichzeitige Prüfungen einer Sitzung teilen sich eine
 * Anfrage, denn ein Refresh-Token gilt nur einmal. Antwortet der Hub nicht, bleibt die Sitzung und es gibt in einer Minute
 * einen neuen Versuch. @return false, wenn die Sitzung beendet wurde.
 */
async function checkWithHub(d: Deps, idHash: string, sub: string, now: Date): Promise<boolean> {
  const running = checks.get(idHash);
  if (running) return running;
  const p = (async () => {
    const row = d.db.select().from(sessions).where(eq(sessions.idHash, idHash)).get();
    if (!row) return false;
    if (row.checkAt > now.toISOString()) return true; // eine andere Anfrage hat schon geprüft
    try {
      let current = row;
      if (row.refreshToken) {
        const { refreshToken } = await d.oidc.refresh(row.refreshToken);
        // Sofort speichern: Das alte Token ist verbraucht, geht das neue verloren, ist die Sitzung nicht mehr erneuerbar
        updateAfterHubCheck(d.db, row, { refreshToken, operator: row.operator }, now);
        current = { ...row, refreshToken: refreshToken ?? row.refreshToken };
      }
      const { access, operator } = await d.hub.isOperator(sub);
      if (!access) {
        deleteSessionById(d.db, idHash);
        return false;
      }
      updateAfterHubCheck(d.db, current, { refreshToken: null, operator }, now);
      return true;
    } catch (err) {
      if (err instanceof HubError && err.kind === "invalid_grant") {
        deleteSessionById(d.db, idHash);
        return false;
      }
      console.error("Zugangsprüfung beim Hub nicht möglich:", err instanceof Error ? err.name : "Fehler");
      retryHubCheckSoon(d.db, row, now);
      return true;
    }
  })().finally(() => checks.delete(idHash));
  checks.set(idHash, p);
  return p;
}

/** Das angemeldete Konto zum Cookie-Wert (null: keine Sitzung, abgelaufen, beendet oder Zugang beim Hub weg). */
export async function authenticate(d: Deps, token: string | undefined, now: Date = new Date()): Promise<Auth | null> {
  let found = findSession(d.db, token, now);
  if (!found) return null;
  if (found.session.checkAt <= now.toISOString()) {
    if (!found.user.sub || !(await checkWithHub(d, found.session.idHash, found.user.sub, now))) return null;
    found = findSession(d.db, token, now);
    if (!found) return null;
  }
  slideSession(d.db, found.session, d.idleSeconds, now);
  await refreshIdentities(d.db, d.hub);
  const id = identityOf(found.user.id);
  const user: SessionUser = {
    ...found.user,
    username: id?.username ?? found.user.legacyUsername ?? "(unbekannt)",
    displayName: id?.username ?? found.user.legacyDisplayName ?? "(unbekannt)",
    email: id?.email ?? null,
    emailVerified: id?.emailVerified ?? false,
    role: found.session.operator ? "operator" : "user",
  };
  return { user, session: found.session };
}
