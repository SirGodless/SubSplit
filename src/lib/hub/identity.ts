import { isNotNull } from "drizzle-orm";
import type { Db } from "@/db/client";
import { users } from "@/db/schema";
import type { HubApi, HubUser } from "./client";

/**
 * Namen und Adressen gehören dem Hub. SubSplit holt sie dort ab und hält sie nur im Arbeitsspeicher (kurz), nie in der
 * Datenbank. Vor dem Aufbau einer Seite oder Antwort ruft der Server `refreshIdentities` auf, danach lesen die (synchronen)
 * Ansichten mit `identityOf` aus diesem Speicher.
 */

const TTL_MS = 60_000;
const g = globalThis as unknown as { __subsplitIdentities?: { byUserId: Map<number, HubUser>; at: number; loading: Promise<void> | null } };
const store = () => (g.__subsplitIdentities ??= { byUserId: new Map(), at: 0, loading: null });

/** Der Nutzer laut Hub (null, wenn noch nicht abgefragt, unbekannt oder der Hub nicht erreichbar war). */
export function identityOf(userId: number): HubUser | undefined {
  return store().byUserId.get(userId);
}

/** Name zur Anzeige: der Benutzername im Hub. Ohne Antwort des Hubs ein Platzhalter statt eines Fehlers. */
export function displayNameOf(userId: number): string {
  return identityOf(userId)?.username ?? "(unbekannt)";
}

/**
 * Holt die Daten aller bekannten Konten (höchstens ein Abruf pro Minute, gleichzeitige Aufrufe teilen sich einen).
 * Fällt der Hub aus, bleiben die zuletzt bekannten Daten stehen.
 */
export async function refreshIdentities(db: Db, hub: HubApi, opts: { force?: boolean; now?: number } = {}): Promise<void> {
  const s = store();
  const now = opts.now ?? Date.now();
  if (!opts.force && now - s.at < TTL_MS) return;
  s.loading ??= (async () => {
    try {
      const rows = db.select({ id: users.id, sub: users.sub }).from(users).where(isNotNull(users.sub)).all();
      const bySub = new Map(rows.map((r) => [r.sub!, r.id]));
      const fetched = await hub.users([...bySub.keys()]);
      for (const u of fetched) {
        const id = bySub.get(u.sub);
        if (id !== undefined) s.byUserId.set(id, u);
      }
      s.at = now;
    } catch (err) {
      console.error("Nutzerdaten vom Hub nicht abrufbar:", err instanceof Error ? err.name : "Fehler");
      s.at = now - TTL_MS + 10_000; // in 10 Sekunden erneut versuchen, nicht bei jeder Anfrage
    } finally {
      s.loading = null;
    }
  })();
  await s.loading;
}

/** Nur für Tests. */
export function resetIdentities(): void {
  g.__subsplitIdentities = undefined;
}

/** Nur für Tests: Daten direkt setzen. */
export function setIdentity(userId: number, user: HubUser): void {
  store().byUserId.set(userId, user);
  store().at = Date.now();
}
