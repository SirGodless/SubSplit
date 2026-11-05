import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { invitations, users } from "@/db/schema";
import type { InviteSettings } from "@/lib/config";
import type { SecurityLogger } from "@/lib/security/security-log";
import { generateToken, hashToken, isWellFormedToken } from "@/lib/security/tokens";
import { AppError } from "./errors";
import { createUserWithPassword, normalizeUsername, cleanDisplayName, validatePassword } from "./users";

export const MAX_ACTIVE_INVITATIONS = 5;
export const DEFAULT_INVITE_SETTINGS: InviteSettings = { creators: "all", maxActive: MAX_ACTIVE_INVITATIONS };

export type Creator = { id: number; role: "operator" | "user" };

/** Darf dieses Konto nach den aktuellen Einstellungen Einladungen erstellen? */
export function canCreateInvitations(creator: Creator, settings: InviteSettings): boolean {
  return settings.maxActive > 0 && (settings.creators === "all" || creator.role === "operator");
}
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const activeWhere = (creatorId: number, now: Date) =>
  and(eq(invitations.creatorUserId, creatorId), isNull(invitations.consumedAt), isNull(invitations.revokedAt), gt(invitations.expiresAt, now.toISOString()));

/** Erzeugt einen Einladungslink (7 Tage gültig). Höchstens `settings.maxActive` offene gleichzeitig pro Konto. */
export function createInvitation(db: Db, creator: Creator, settings: InviteSettings = DEFAULT_INVITE_SETTINGS, now: Date = new Date()): string {
  if (!canCreateInvitations(creator, settings))
    throw new AppError("not_allowed", settings.maxActive === 0 ? "Einladungen sind abgeschaltet." : "Einladungslinks kann nur der Betreiber erstellen.");
  const active = db.select({ c: sql<number>`count(*)` }).from(invitations).where(activeWhere(creator.id, now)).get();
  if ((active?.c ?? 0) >= settings.maxActive)
    throw new AppError("not_allowed", `Du hast schon ${settings.maxActive} offene Einladungslinks. Warte, bis einer abläuft oder eingelöst wird, oder widerrufe einen.`);
  const token = generateToken();
  db.insert(invitations).values({ creatorUserId: creator.id, tokenHash: hashToken(token), expiresAt: new Date(now.getTime() + INVITE_TTL_MS).toISOString() }).run();
  return token;
}

export interface InvitationItem {
  id: number;
  createdAt: string;
  expiresAt: string;
  state: "open" | "used" | "expired" | "revoked";
  /** Anzeigename des Kontos, das den Link eingelöst hat. */
  usedBy: string | null;
}

export function listInvitations(db: Db, creator: Creator, settings: InviteSettings = DEFAULT_INVITE_SETTINGS, now: Date = new Date()): { max: number; canCreate: boolean; activeCount: number; items: InvitationItem[] } {
  const creatorId = creator.id;
  const rows = db
    .select({ i: invitations, usedBy: users.displayName })
    .from(invitations)
    .leftJoin(users, eq(users.id, invitations.consumedByUserId))
    .where(eq(invitations.creatorUserId, creatorId))
    .orderBy(desc(invitations.createdAt), desc(invitations.id))
    .limit(50)
    .all();
  const iso = now.toISOString();
  const items = rows.map(({ i, usedBy }): InvitationItem => ({
    id: i.id, createdAt: i.createdAt, expiresAt: i.expiresAt, usedBy: usedBy ?? null,
    state: i.consumedAt ? "used" : i.revokedAt ? "revoked" : i.expiresAt <= iso ? "expired" : "open",
  }));
  return { max: settings.maxActive, canCreate: canCreateInvitations(creator, settings), activeCount: items.filter((i) => i.state === "open").length, items };
}

/** Widerruft einen offenen Link (eigener, noch nicht eingelöster). Das gibt den Platz unter dem 5er-Limit wieder frei. */
export function revokeInvitation(db: Db, creatorId: number, id: number, now: Date = new Date()): void {
  const res = db
    .update(invitations)
    .set({ revokedAt: now.toISOString() })
    .where(and(eq(invitations.id, id), eq(invitations.creatorUserId, creatorId), isNull(invitations.consumedAt), isNull(invitations.revokedAt)))
    .run();
  if (res.changes === 0) throw new AppError("not_found", "Einladung nicht gefunden.");
}

type Found = { id: number; ok: true } | { ok: false; reason: "unknown" | "unusable" };

function findUsable(db: Db, token: string, settings: InviteSettings, now: Date): Found {
  if (!isWellFormedToken(token)) return { ok: false, reason: "unknown" };
  const row = db.select().from(invitations).where(eq(invitations.tokenHash, hashToken(token))).get();
  if (!row) return { ok: false, reason: "unknown" };
  const creator = db.select({ role: users.role, disabledAt: users.disabledAt }).from(users).where(eq(users.id, row.creatorUserId)).get();
  // Wirkt sofort: wird die Erlaubnis in den Einstellungen entzogen, sind auch bereits erstellte Links unbrauchbar.
  if (row.consumedAt || row.revokedAt || row.expiresAt <= now.toISOString() || !creator || creator.disabledAt || !canCreateInvitations({ id: row.creatorUserId, role: creator.role }, settings))
    return { ok: false, reason: "unusable" };
  return { id: row.id, ok: true };
}

/**
 * Prüft einen Einladungslink beim Öffnen der Seite. Unbekannt -> AUTHFAIL; eingelöst/abgelaufen/widerrufen ->
 * nur NOTICE (kein Ban, jemand mit einem alten Link soll nicht gesperrt werden). Für den Client sehen beide gleich aus.
 */
export function peekInvitation(db: Db, token: string, ip: string, logger: SecurityLogger, settings: InviteSettings = DEFAULT_INVITE_SETTINGS, now: Date = new Date()): boolean {
  const found = findUsable(db, token, settings, now);
  if (found.ok) return true;
  if (found.reason === "unknown") logger.authFail(ip, "invalid_token");
  else logger.notice(ip, "revoked_token");
  return false;
}

/**
 * Löst den Link ein: legt das Konto mit eigenem Benutzernamen, Anzeigenamen und Passwort an und verbraucht den Link.
 * Alles in einer Transaktion: scheitert etwas (z. B. Benutzername vergeben), bleibt der Link unverbraucht.
 */
export function acceptInvitation(
  db: Db,
  token: string,
  input: { username: string; displayName: string; password: string },
  settings: InviteSettings = DEFAULT_INVITE_SETTINGS,
  now: Date = new Date(),
): { userId: number; sessionVersion: number } {
  const found = findUsable(db, token, settings, now);
  if (!found.ok) throw new AppError("not_found", "Der Link ist ungültig oder abgelaufen.");
  normalizeUsername(input.username);
  cleanDisplayName(input.displayName);
  validatePassword(input.password);
  return db.transaction((tx) => {
    const userId = createUserWithPassword(tx as unknown as Db, input);
    const res = tx
      .update(invitations)
      .set({ consumedAt: now.toISOString(), consumedByUserId: userId })
      .where(and(eq(invitations.id, found.id), isNull(invitations.consumedAt), isNull(invitations.revokedAt)))
      .run();
    if (res.changes === 0) throw new AppError("not_found", "Der Link ist ungültig oder abgelaufen.");
    return { userId, sessionVersion: 0 };
  });
}
