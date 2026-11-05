import { and, asc, eq, gt, isNull, ne, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { subscriptions, users } from "@/db/schema";
import { isValidIban, normalizeIban } from "@/lib/config/iban";
import { hashPassword, verifyPassword } from "@/lib/security/password";
import type { SecurityLogger } from "@/lib/security/security-log";
import { generateToken, hashToken, isWellFormedToken } from "@/lib/security/tokens";
import { AppError } from "./errors";

export type UserRow = typeof users.$inferSelect;

export const SETUP_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const BOOTSTRAP_TTL_MS = 24 * 60 * 60 * 1000;
/** Die bekannte Beispiel-IBAN aus der Dokumentation, nie als echtes Zahlungsziel zulassen. */
const EXAMPLE_IBANS = new Set(["DE89370400440532013000"]);
// Im Test genügt ein billiger scrypt-Aufwand; die Parameter stehen im Hash, Prüfen funktioniert trotzdem.
const COST = process.env.NODE_ENV === "test" ? { N: 1024, r: 8, p: 1 } : undefined;
let dummyHash: string | undefined;

const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,29}$/;

export function normalizeUsername(raw: string): string {
  const v = raw.trim().toLowerCase();
  if (!USERNAME_RE.test(v)) throw new AppError("invalid", "Benutzername: 3-30 Zeichen, Kleinbuchstaben, Ziffern, Punkt, Unterstrich oder Bindestrich.");
  return v;
}

export function cleanDisplayName(raw: string): string {
  const v = raw.trim();
  if (!v || v.length > 60) throw new AppError("invalid", "Anzeigename muss 1-60 Zeichen lang sein.");
  return v;
}

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;
export function normalizeEmail(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim();
  if (!v) return null;
  if (v.length > 320 || !EMAIL_RE.test(v)) throw new AppError("invalid", "Ungültige E-Mail-Adresse.");
  return v;
}

export function validatePassword(pw: string): void {
  if (typeof pw !== "string" || pw.length < 12) throw new AppError("invalid", "Das Passwort muss mindestens 12 Zeichen lang sein.");
  if (pw.length > 200) throw new AppError("invalid", "Das Passwort ist zu lang (höchstens 200 Zeichen).");
}

// ---------- Konten anlegen, Einrichtungslinks ----------

export function createUser(db: Db, input: { username: string; displayName: string; email?: string | null; role?: "operator" | "user" }): number {
  const username = normalizeUsername(input.username);
  const displayName = cleanDisplayName(input.displayName);
  const email = normalizeEmail(input.email);
  try {
    return db.insert(users).values({ username, displayName, email, role: input.role ?? "user" }).returning({ id: users.id }).get().id;
  } catch (err) {
    if (err instanceof Error && /UNIQUE constraint failed: users\.username/.test(err.message)) throw new AppError("invalid", "Dieser Benutzername ist schon vergeben.");
    throw err;
  }
}

/** Legt ein Konto mit eigenem Passwort an (Einlösen eines Einladungslinks). */
export function createUserWithPassword(db: Db, input: { username: string; displayName: string; password: string }): number {
  validatePassword(input.password);
  const id = createUser(db, { username: input.username, displayName: input.displayName });
  db.update(users).set({ passwordHash: hashPassword(input.password, COST) }).where(eq(users.id, id)).run();
  return id;
}

/** Erzeugt einen einmaligen Einrichtungslink (Erst-Einrichtung oder Passwort-Reset). Ein alter Link wird ungültig. */
export function createSetupLink(db: Db, userId: number, now: Date = new Date(), ttlMs = SETUP_TTL_MS): string {
  const token = generateToken();
  const res = db
    .update(users)
    .set({ setupTokenHash: hashToken(token), setupExpiresAt: new Date(now.getTime() + ttlMs).toISOString() })
    .where(and(eq(users.id, userId), isNull(users.disabledAt)))
    .run();
  if (res.changes === 0) throw new AppError("not_found", "Konto nicht gefunden oder gesperrt.");
  return token;
}

export type SetupLookup = { kind: "ok"; userId: number; displayName: string; username: string } | { kind: "denied" };

/**
 * Prüft einen Einrichtungslink beim Öffnen der Seite. Unbekannt/ungültig -> AUTHFAIL; abgelaufen -> nur NOTICE
 * (kein Ban). Für den Client sehen beide Fälle gleich aus.
 */
export function peekSetupToken(db: Db, token: string, ip: string, logger: SecurityLogger, now: Date = new Date()): SetupLookup {
  if (!isWellFormedToken(token)) {
    logger.authFail(ip, "invalid_token");
    return { kind: "denied" };
  }
  const row = db.select().from(users).where(eq(users.setupTokenHash, hashToken(token))).get();
  if (!row) {
    logger.authFail(ip, "invalid_token");
    return { kind: "denied" };
  }
  if (row.disabledAt || !row.setupExpiresAt || row.setupExpiresAt <= now.toISOString()) {
    logger.notice(ip, "revoked_token");
    return { kind: "denied" };
  }
  return { kind: "ok", userId: row.id, displayName: row.displayName, username: row.username };
}

/** Setzt das Passwort über einen gültigen Einrichtungslink und verbraucht ihn. */
export function completeSetup(db: Db, token: string, password: string, now: Date = new Date()): { userId: number; sessionVersion: number } {
  validatePassword(password);
  if (!isWellFormedToken(token)) throw new AppError("not_found", "Der Link ist ungültig oder abgelaufen.");
  const row = db.select().from(users).where(eq(users.setupTokenHash, hashToken(token))).get();
  if (!row || row.disabledAt || !row.setupExpiresAt || row.setupExpiresAt <= now.toISOString()) throw new AppError("not_found", "Der Link ist ungültig oder abgelaufen.");
  const sessionVersion = row.sessionVersion + 1;
  db.update(users)
    .set({ passwordHash: hashPassword(password, COST), setupTokenHash: null, setupExpiresAt: null, sessionVersion })
    .where(eq(users.id, row.id))
    .run();
  return { userId: row.id, sessionVersion };
}

// ---------- Login / Sitzung ----------

/** Prüft Benutzername und Passwort. Gleiche Laufzeit, egal ob das Konto existiert. Gesperrt/ungeprüft -> null. */
export function authenticate(db: Db, username: string, password: string, now: Date = new Date()): { id: number; sessionVersion: number } | null {
  let name = "";
  try {
    name = normalizeUsername(username);
  } catch {
    /* ungültiges Format: trotzdem Dummy-Prüfung unten */
  }
  const row = name ? db.select().from(users).where(eq(users.username, name)).get() : undefined;
  dummyHash ??= hashPassword("dummy-passwort-fuer-gleiche-laufzeit", COST);
  const ok = verifyPassword(typeof password === "string" ? password.slice(0, 500) : "", row?.passwordHash ?? dummyHash);
  if (!row || !row.passwordHash || row.disabledAt || !ok) return null;
  db.update(users).set({ lastLoginAt: now.toISOString() }).where(eq(users.id, row.id)).run();
  return { id: row.id, sessionVersion: row.sessionVersion };
}

/** Aktuelles Konto zur Sitzung; null bei gesperrtem Konto oder abgelaufener Sitzungsversion. */
export function getSessionUser(db: Db, uid: number, sv: number): UserRow | null {
  const row = db.select().from(users).where(eq(users.id, uid)).get();
  if (!row || row.disabledAt || !row.passwordHash || row.sessionVersion !== sv) return null;
  return row;
}

export function changePassword(db: Db, userId: number, current: string, next: string): number {
  validatePassword(next);
  const row = db.select().from(users).where(eq(users.id, userId)).get();
  if (!row || !row.passwordHash || !verifyPassword(current.slice(0, 500), row.passwordHash)) throw new AppError("invalid", "Das aktuelle Passwort stimmt nicht.");
  const sessionVersion = row.sessionVersion + 1;
  db.update(users).set({ passwordHash: hashPassword(next, COST), sessionVersion }).where(eq(users.id, userId)).run();
  return sessionVersion;
}

/** Betreiber: Konto sperren/entsperren. Beendet alle Sitzungen. Der letzte aktive Betreiber lässt sich nicht sperren. */
export function setDisabled(db: Db, targetId: number, disabled: boolean, actingUserId: number, now: Date = new Date()): void {
  const row = db.select().from(users).where(eq(users.id, targetId)).get();
  if (!row) throw new AppError("not_found", "Konto nicht gefunden.");
  if (disabled) {
    if (targetId === actingUserId) throw new AppError("not_allowed", "Du kannst dich nicht selbst sperren.");
    if (row.role === "operator") {
      const others = db.select({ c: sql<number>`count(*)` }).from(users).where(and(eq(users.role, "operator"), isNull(users.disabledAt), ne(users.id, targetId))).get();
      if ((others?.c ?? 0) === 0) throw new AppError("not_allowed", "Der letzte aktive Betreiber kann nicht gesperrt werden.");
    }
  }
  db.update(users)
    .set({ disabledAt: disabled ? now.toISOString() : null, sessionVersion: row.sessionVersion + 1, ...(disabled ? { setupTokenHash: null, setupExpiresAt: null } : {}) })
    .where(eq(users.id, targetId))
    .run();
}

// ---------- Profil und Empfängerdaten ----------

export function updateProfile(db: Db, userId: number, input: { displayName?: string; email?: string | null }): void {
  const set: Partial<typeof users.$inferInsert> = {};
  if (input.displayName !== undefined) set.displayName = cleanDisplayName(input.displayName);
  if (input.email !== undefined) {
    const email = normalizeEmail(input.email);
    const cur = db.select({ email: users.email }).from(users).where(eq(users.id, userId)).get();
    if (cur && cur.email !== email) {
      set.email = email;
      set.emailVerifiedAt = null; // neue Adresse muss neu bestätigt werden
    }
  }
  if (Object.keys(set).length === 0) return;
  if (db.update(users).set(set).where(eq(users.id, userId)).run().changes === 0) throw new AppError("not_found", "Konto nicht gefunden.");
}

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

/** Konten, aus denen ein Empfänger Mitzahler auswählen kann (nur Anzeigename und Benutzername). */
export function listDirectory(db: Db): Array<{ id: number; displayName: string; username: string }> {
  return db
    .select({ id: users.id, displayName: users.displayName, username: users.username })
    .from(users)
    .where(isNull(users.disabledAt))
    .orderBy(asc(users.displayName))
    .all();
}

// ---------- Ersteinrichtung ----------

/** Stellt sicher, dass es einen Betreiber gibt (Konto "admin", Passwort folgt über den Einrichtungslink). */
export function ensureOperator(db: Db): { id: number; created: boolean } {
  const existing = db.select({ id: users.id }).from(users).where(eq(users.role, "operator")).get();
  if (existing) return { id: existing.id, created: false };
  return { id: createUser(db, { username: "admin", displayName: "Admin", role: "operator" }), created: true };
}

/** Solange ein Betreiber noch kein Passwort hat: frischer Einrichtungslink (24 h) für das Startlog. */
export function bootstrapSetupToken(db: Db, now: Date = new Date()): { token: string; username: string } | null {
  const row = db.select().from(users).where(and(eq(users.role, "operator"), isNull(users.passwordHash), isNull(users.disabledAt), gt(users.id, 0))).get();
  if (!row) return null;
  return { token: createSetupLink(db, row.id, now, BOOTSTRAP_TTL_MS), username: row.username };
}
