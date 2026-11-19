import { and, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { subscriptions, users } from "@/db/schema";
import { isValidIban, normalizeIban } from "@/lib/config/iban";
import type { HubApi } from "@/lib/hub/client";
import { setIdentity } from "@/lib/hub/identity";
import { AppError } from "./errors";

export type UserRow = typeof users.$inferSelect;

/** Die bekannte Beispiel-IBAN aus der Dokumentation, nie als echtes Zahlungsziel zulassen. */
const EXAMPLE_IBANS = new Set(["DE89370400440532013000"]);

// ---------- Konten aus dem Hub ----------

/**
 * Das lokale Konto zur Kennung (UUID) aus dem Hub. Beim ersten Mal wird es angelegt. SubSplit speichert nur diese Kennung
 * und die eigenen Daten (Empfängerdaten, Einstellungen); Benutzername, Name und Adresse bleiben beim Hub.
 */
export function ensureUser(db: Db, sub: string): UserRow {
  const existing = db.select().from(users).where(eq(users.sub, sub)).get();
  if (existing) return existing;
  return db.insert(users).values({ sub }).onConflictDoNothing().returning().get() ?? db.select().from(users).where(eq(users.sub, sub)).get()!;
}

export function markLogin(db: Db, userId: number, now: Date = new Date()): void {
  db.update(users).set({ lastLoginAt: now.toISOString() }).where(eq(users.id, userId)).run();
}

/**
 * Konten, aus denen ein Empfänger Mitzahler auswählen kann: alle Nutzer mit Zugang zu SubSplit laut Hub. Wer noch nie hier
 * angemeldet war, bekommt dabei sein lokales Konto (ohne Daten), damit man ihn als Mitzahler eintragen kann.
 */
export async function listDirectory(db: Db, hub: HubApi): Promise<Array<{ id: number; displayName: string }>> {
  const all = await hub.usersWithAccess();
  return all
    .map((u) => {
      const row = ensureUser(db, u.sub);
      setIdentity(row.id, u);
      return { id: row.id, displayName: u.username };
    })
    .sort((a, b) => a.displayName.localeCompare(b.displayName, "de"));
}

// ---------- Empfängerdaten ----------

export function hasPaymentMethod(u: Pick<UserRow, "iban" | "paypalMe">): boolean {
  return !!(u.iban || u.paypalMe);
}

function normalizePaypalMe(raw: string): string | null {
  let v = raw.trim().replace(/^https?:\/\/(www\.)?paypal\.(me|com\/paypalme)\//i, "").replace(/^paypal\.me\//i, "").replace(/\/+$/, "");
  if (!v) return null;
  if (!/^[A-Za-z0-9]{1,20}$/.test(v)) throw new AppError("invalid", "PayPal.Me-Name: nur Buchstaben und Ziffern, höchstens 20 Zeichen (ohne „paypal.me/“).");
  v = v.trim();
  return v;
}

/** Empfängerdaten eines Kontos. Alles optional; ein Konto mit aktiven Abos braucht aber mindestens IBAN oder PayPal.Me. */
export function updateRecipient(db: Db, userId: number, input: { recipientName?: string | null; paypalMe?: string | null; iban?: string | null; dueDay?: number }): void {
  const cur = db.select().from(users).where(eq(users.id, userId)).get();
  if (!cur) throw new AppError("not_found", "Konto nicht gefunden.");
  const set: Partial<typeof users.$inferInsert> = {};
  if (input.recipientName !== undefined) {
    const v = (input.recipientName ?? "").trim();
    if (v.length > 70) throw new AppError("invalid", "Empfängername: höchstens 70 Zeichen.");
    set.recipientName = v || null;
  }
  if (input.paypalMe !== undefined) set.paypalMe = input.paypalMe ? normalizePaypalMe(input.paypalMe) : null;
  if (input.iban !== undefined) {
    const v = (input.iban ?? "").trim();
    if (!v) set.iban = null;
    else {
      if (!isValidIban(v)) throw new AppError("invalid", "Die IBAN ist ungültig (Format oder Prüfsumme).");
      const norm = normalizeIban(v);
      if (EXAMPLE_IBANS.has(norm)) throw new AppError("invalid", "Das ist die Beispiel-IBAN aus der Dokumentation. Bitte deine eigene IBAN eintragen.");
      set.iban = norm;
    }
  }
  if (input.dueDay !== undefined) {
    if (!Number.isInteger(input.dueDay) || input.dueDay < 1 || input.dueDay > 28) throw new AppError("invalid", "Der Fälligkeitstag muss zwischen 1 und 28 liegen.");
    set.dueDay = input.dueDay;
  }
  const merged = { iban: "iban" in set ? set.iban ?? null : cur.iban, paypalMe: "paypalMe" in set ? set.paypalMe ?? null : cur.paypalMe };
  if (!hasPaymentMethod(merged)) {
    const owns = db.select({ c: sql<number>`count(*)` }).from(subscriptions).where(and(eq(subscriptions.ownerUserId, userId), isNull(subscriptions.archivedAt))).get();
    if ((owns?.c ?? 0) > 0) throw new AppError("not_allowed", "Solange du Abos hast, braucht es mindestens IBAN oder PayPal.Me.");
  }
  if (Object.keys(set).length > 0) db.update(users).set(set).where(eq(users.id, userId)).run();
}

/** Zum Anlegen eines Abos braucht es mindestens IBAN oder PayPal.Me. */
export function assertCanOwnSubscriptions(db: Db, userId: number): void {
  const u = db.select({ iban: users.iban, paypalMe: users.paypalMe }).from(users).where(eq(users.id, userId)).get();
  if (!u) throw new AppError("not_found", "Konto nicht gefunden.");
  if (!hasPaymentMethod(u)) throw new AppError("not_allowed", "Bitte zuerst in den Einstellungen mindestens IBAN oder PayPal.Me eintragen.");
}
