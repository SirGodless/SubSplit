import { randomUUID } from "node:crypto";
import type { Db } from "@/db/client";
import { users } from "@/db/schema";
import type { HubUser } from "@/lib/hub/client";
import { identityOf, setIdentity } from "@/lib/hub/identity";

/**
 * Ein Konto für Tests (der Name im Hub ist `displayName`, falls angegeben, damit Erwartungen lesbar bleiben): lokale Zeile mit zufälliger Hub-Kennung plus der Stand, den der Hub dazu liefern würde.
 * Benutzername, Adresse und Sperre gehören dem Hub, deshalb stehen sie nur im Identitäts-Speicher.
 */
export function createUser(db: Db, input: { username: string; displayName?: string; email?: string | null; verified?: boolean; role?: "operator" | "user" }): number {
  const sub = randomUUID();
  const id = db.insert(users).values({ sub }).returning({ id: users.id }).get().id;
  setIdentity(id, {
    sub, username: input.displayName ?? input.username, email: input.email ?? null, emailVerified: input.verified ?? !!input.email,
    locale: "de", banned: false, access: true,
  });
  return id;
}

/** Ändert, was der Hub über das Konto sagt (Sperre, Zugang, Adresse). */
export function hubChange(id: number, patch: Partial<HubUser>): void {
  const cur = identityOf(id);
  if (!cur) throw new Error("Konto unbekannt");
  setIdentity(id, { ...cur, ...patch });
}

/** Der Hub sperrt das Konto (oder hebt die Sperre auf). */
export function setBanned(id: number, banned: boolean): void {
  hubChange(id, { banned, access: !banned });
}
