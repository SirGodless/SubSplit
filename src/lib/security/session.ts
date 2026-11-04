import { createHmac, randomBytes } from "node:crypto";
import { safeEqual } from "./tokens";

export const SESSION_COOKIE = "subsplit_admin";
export const SESSION_TTL_SECONDS = 8 * 60 * 60;

export interface SessionPayload {
  exp: number; // Unix-Sekunden
  csrf: string;
}

function sign(data: string, secret: string): string {
  return createHmac("sha256", secret).update(data).digest("base64url");
}

export function createSession(secret: string, now = Date.now()): { value: string; payload: SessionPayload } {
  const payload: SessionPayload = { exp: Math.floor(now / 1000) + SESSION_TTL_SECONDS, csrf: randomBytes(24).toString("base64url") };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return { value: `${body}.${sign(body, secret)}`, payload };
}

export function verifySession(value: string | undefined, secret: string, now = Date.now()): SessionPayload | null {
  if (!value) return null;
  const [body, sig, ...rest] = value.split(".");
  if (!body || !sig || rest.length > 0 || !safeEqual(sig, sign(body, secret))) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SessionPayload;
    if (typeof payload.exp !== "number" || typeof payload.csrf !== "string") return null;
    return payload.exp * 1000 > now ? payload : null;
  } catch {
    return null;
  }
}

export function sessionCookie(value: string, secure: boolean): string {
  return [`${SESSION_COOKIE}=${value}`, "Path=/", "HttpOnly", "SameSite=Strict", `Max-Age=${SESSION_TTL_SECONDS}`, ...(secure ? ["Secure"] : [])].join("; ");
}

export function clearSessionCookie(secure: boolean): string {
  return [`${SESSION_COOKIE}=`, "Path=/", "HttpOnly", "SameSite=Strict", "Max-Age=0", ...(secure ? ["Secure"] : [])].join("; ");
}
