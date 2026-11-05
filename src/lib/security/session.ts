import { createHmac, randomBytes } from "node:crypto";
import { safeEqual } from "./tokens";

export const SESSION_COOKIE = "subsplit_session";
/** Inaktivitäts-Timeout: Jede gültige Admin-Anfrage verlängert die Sitzung um diese Zeit. */
export const DEFAULT_IDLE_SECONDS = 30 * 60;

export interface SessionPayload {
  /** Konto-ID. */
  uid: number;
  /** Sitzungsversion des Kontos; Passwortwechsel/Sperre erhöht sie und beendet alle Sitzungen. */
  sv: number;
  exp: number; // Unix-Sekunden, Ablauf bei Inaktivität
  csrf: string;
}

function sign(data: string, secret: string): string {
  return createHmac("sha256", secret).update(data).digest("base64url");
}

function encode(payload: SessionPayload, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body, secret)}`;
}

export function createSession(secret: string, user: { uid: number; sv: number }, now = Date.now(), idleSeconds = DEFAULT_IDLE_SECONDS): { value: string; payload: SessionPayload } {
  const payload: SessionPayload = { uid: user.uid, sv: user.sv, exp: Math.floor(now / 1000) + idleSeconds, csrf: randomBytes(24).toString("base64url") };
  return { value: encode(payload, secret), payload };
}

/** Gleitende Sitzung: gleiches CSRF-Token, Ablauf neu auf jetzt + Inaktivitäts-Timeout. */
export function refreshSession(payload: SessionPayload, secret: string, now = Date.now(), idleSeconds = DEFAULT_IDLE_SECONDS): string {
  return encode({ uid: payload.uid, sv: payload.sv, exp: Math.floor(now / 1000) + idleSeconds, csrf: payload.csrf }, secret);
}

export function verifySession(value: string | undefined, secret: string, now = Date.now()): SessionPayload | null {
  if (!value) return null;
  const [body, sig, ...rest] = value.split(".");
  if (!body || !sig || rest.length > 0 || !safeEqual(sig, sign(body, secret))) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SessionPayload;
    if (typeof payload.exp !== "number" || typeof payload.csrf !== "string" || !Number.isInteger(payload.uid) || !Number.isInteger(payload.sv)) return null;
    return payload.exp * 1000 > now ? payload : null;
  } catch {
    return null;
  }
}

export function sessionCookie(value: string, secure: boolean, maxAgeSeconds = DEFAULT_IDLE_SECONDS): string {
  return [`${SESSION_COOKIE}=${value}`, "Path=/", "HttpOnly", "SameSite=Strict", `Max-Age=${maxAgeSeconds}`, ...(secure ? ["Secure"] : [])].join("; ");
}

export function clearSessionCookie(secure: boolean): string {
  return [`${SESSION_COOKIE}=`, "Path=/", "HttpOnly", "SameSite=Strict", "Max-Age=0", ...(secure ? ["Secure"] : [])].join("; ");
}
