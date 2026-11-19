import { createHash, randomBytes } from "node:crypto";
import { eq, lt } from "drizzle-orm";
import type { Db } from "@/db/client";
import { sessions, users } from "@/db/schema";

/**
 * Sitzungen in der Datenbank. Der Browser hat nur einen zufälligen Wert im Cookie, gespeichert wird dessen SHA-256-Hash.
 * So lässt sich eine Sitzung gezielt beenden (Back-Channel-Logout des Hubs, Bann, Abmelden).
 */

export type SessionRow = typeof sessions.$inferSelect;
export type UserRow = typeof users.$inferSelect;

/** So oft wird der Zugang beim Hub neu geprüft (Refresh-Token). Mit dieser Verzögerung wirken Bann und entzogene Rechte spätestens. */
export const HUB_CHECK_SECONDS = 5 * 60;
/** Das gleitende Ablaufdatum wird höchstens so oft neu geschrieben. */
const SLIDE_MIN_SECONDS = 60;

const hash = (token: string) => createHash("sha256").update(token).digest("hex");
const iso = (ms: number) => new Date(ms).toISOString();

export interface NewSession {
  userId: number;
  hubSid: string | null;
  refreshToken: string | null;
  operator: boolean;
}

/** Legt eine Sitzung an. Gibt den Cookie-Wert (nur jetzt im Klartext) und das CSRF-Token zurück. */
export function createSession(db: Db, input: NewSession, idleSeconds: number, now: Date = new Date()): { token: string; csrf: string } {
  const token = randomBytes(32).toString("base64url");
  const csrf = randomBytes(24).toString("base64url");
  db.insert(sessions).values({
    idHash: hash(token), userId: input.userId, hubSid: input.hubSid, csrf, refreshToken: input.refreshToken, operator: input.operator,
    checkAt: iso(now.getTime() + HUB_CHECK_SECONDS * 1000), expiresAt: iso(now.getTime() + idleSeconds * 1000), createdAt: iso(now.getTime()),
  }).run();
  return { token, csrf };
}

/** Sitzung samt Konto zum Cookie-Wert. Abgelaufene gibt es nicht (und werden dabei gelöscht). */
export function findSession(db: Db, token: string | undefined, now: Date = new Date()): { session: SessionRow; user: UserRow } | null {
  if (!token || token.length > 200) return null;
  const row = db.select({ s: sessions, u: users }).from(sessions).innerJoin(users, eq(users.id, sessions.userId)).where(eq(sessions.idHash, hash(token))).get();
  if (!row) return null;
  if (row.s.expiresAt <= iso(now.getTime())) {
    db.delete(sessions).where(eq(sessions.idHash, row.s.idHash)).run();
    return null;
  }
  return { session: row.s, user: row.u };
}

/** Verlängert die Sitzung bei Aktivität (gleitender Ablauf) und gibt das neue Ablaufdatum zurück. */
export function slideSession(db: Db, session: SessionRow, idleSeconds: number, now: Date = new Date()): void {
  const newExpiry = now.getTime() + idleSeconds * 1000;
  if (newExpiry - Date.parse(session.expiresAt) < SLIDE_MIN_SECONDS * 1000) return;
  db.update(sessions).set({ expiresAt: iso(newExpiry) }).where(eq(sessions.idHash, session.idHash)).run();
}

export function updateAfterHubCheck(db: Db, session: SessionRow, p: { refreshToken: string | null; operator: boolean }, now: Date = new Date()): void {
  db.update(sessions)
    .set({ refreshToken: p.refreshToken ?? session.refreshToken, operator: p.operator, checkAt: iso(now.getTime() + HUB_CHECK_SECONDS * 1000) })
    .where(eq(sessions.idHash, session.idHash)).run();
}

/** Prüfung des Hubs gescheitert, weil er nicht antwortet: bald erneut versuchen, die Sitzung bleibt vorerst. */
export function retryHubCheckSoon(db: Db, session: SessionRow, now: Date = new Date()): void {
  db.update(sessions).set({ checkAt: iso(now.getTime() + 60_000) }).where(eq(sessions.idHash, session.idHash)).run();
}

export function deleteSessionByToken(db: Db, token: string | undefined): void {
  if (token) db.delete(sessions).where(eq(sessions.idHash, hash(token))).run();
}

export function deleteSessionById(db: Db, idHash: string): void {
  db.delete(sessions).where(eq(sessions.idHash, idHash)).run();
}

/** Logout-Token mit sid: nur die Sitzungen aus dieser Hub-Sitzung. @return Anzahl */
export function deleteSessionsByHubSid(db: Db, hubSid: string): number {
  return db.delete(sessions).where(eq(sessions.hubSid, hubSid)).run().changes;
}

/** Logout-Token ohne sid: alle Sitzungen dieses Nutzers (Bann, Passwort-Reset im Hub). @return Anzahl */
export function deleteSessionsOfSub(db: Db, sub: string): number {
  const u = db.select({ id: users.id }).from(users).where(eq(users.sub, sub)).get();
  return u ? db.delete(sessions).where(eq(sessions.userId, u.id)).run().changes : 0;
}

export function purgeExpiredSessions(db: Db, now: Date = new Date()): void {
  db.delete(sessions).where(lt(sessions.expiresAt, iso(now.getTime()))).run();
}

/** Zum Wiederfinden einer Sitzung nach der Kennung des Cookie-Werts, z. B. für Tests. */
export const sessionHash = hash;
