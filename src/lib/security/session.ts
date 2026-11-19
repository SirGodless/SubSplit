import { createHmac } from "node:crypto";
import { safeEqual } from "./tokens";

/** Cookies der Anmeldung. Die Sitzung selbst steht in der Datenbank (services/sessions.ts), im Cookie nur ein zufälliger Wert. */

export const SESSION_COOKIE = "subsplit_session";
/** Merkt sich während der Weiterleitung zum Hub: state, nonce, PKCE-Verifier und das Ziel danach. Kurz gültig. */
export const OIDC_COOKIE = "subsplit_oidc";
export const OIDC_COOKIE_SECONDS = 10 * 60;
/** Inaktivitäts-Timeout: Jede gültige Anfrage verlängert die Sitzung um diese Zeit. */
export const DEFAULT_IDLE_SECONDS = 30 * 60;

export function sessionCookie(value: string, secure: boolean, maxAgeSeconds = DEFAULT_IDLE_SECONDS): string {
  return [`${SESSION_COOKIE}=${value}`, "Path=/", "HttpOnly", "SameSite=Strict", `Max-Age=${maxAgeSeconds}`, ...(secure ? ["Secure"] : [])].join("; ");
}

export function clearSessionCookie(secure: boolean): string {
  return [`${SESSION_COOKIE}=`, "Path=/", "HttpOnly", "SameSite=Strict", "Max-Age=0", ...(secure ? ["Secure"] : [])].join("; ");
}

// ---------- Cookie der Weiterleitung zum Hub ----------

export interface OidcFlowState {
  state: string;
  nonce: string;
  verifier: string;
  /** Ziel innerhalb der App nach der Anmeldung. */
  next: string | null;
  exp: number; // Unix-Sekunden
}

const sign = (data: string, secret: string) => createHmac("sha256", secret).update(`oidc:${data}`).digest("base64url");

/** Signiert, damit niemand state oder nonce unterschieben kann. SameSite=Lax, weil der Hub mit einer Weiterleitung zurückkommt. */
export function oidcCookie(flow: Omit<OidcFlowState, "exp">, secret: string, secure: boolean, now = Date.now()): string {
  const body = Buffer.from(JSON.stringify({ ...flow, exp: Math.floor(now / 1000) + OIDC_COOKIE_SECONDS })).toString("base64url");
  return [`${OIDC_COOKIE}=${body}.${sign(body, secret)}`, "Path=/auth", "HttpOnly", "SameSite=Lax", `Max-Age=${OIDC_COOKIE_SECONDS}`, ...(secure ? ["Secure"] : [])].join("; ");
}

export function clearOidcCookie(secure: boolean): string {
  return [`${OIDC_COOKIE}=`, "Path=/auth", "HttpOnly", "SameSite=Lax", "Max-Age=0", ...(secure ? ["Secure"] : [])].join("; ");
}

export function readOidcCookie(value: string | undefined, secret: string, now = Date.now()): OidcFlowState | null {
  if (!value) return null;
  const [body, sig, ...rest] = value.split(".");
  if (!body || !sig || rest.length > 0 || !safeEqual(sig, sign(body, secret))) return null;
  try {
    const flow = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as OidcFlowState;
    const ok = typeof flow.state === "string" && typeof flow.nonce === "string" && typeof flow.verifier === "string" && typeof flow.exp === "number";
    return ok && flow.exp * 1000 > now ? flow : null;
  } catch {
    return null;
  }
}
