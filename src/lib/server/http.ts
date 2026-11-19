import { ZodError } from "zod";
import { csrfTokenValid, isSameOrigin } from "@/lib/security/csrf";
import { SESSION_COOKIE, sessionCookie } from "@/lib/security/session";
import { AppError } from "@/lib/services/errors";
import type { SessionRow } from "@/lib/services/sessions";
import { ctx, secureCookies } from "./context";
import { authenticate, type SessionUser } from "./session-auth";

export const NO_STORE = { "Cache-Control": "no-store" };

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(data, { status, headers: { ...NO_STORE, ...headers } });
}

export const notFound = () => json({ error: "not_found" }, 404);

export function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return undefined;
}

export function errorResponse(err: unknown): Response {
  if (err instanceof ZodError) return json({ error: "invalid_input", message: "Ungültige Eingabe.", issues: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })) }, 400);
  if (err instanceof AppError) return json({ error: err.code, message: err.message }, err.code === "not_found" ? 404 : err.code === "not_allowed" ? 409 : 400);
  if (err instanceof Error && /^Ungültiger Monat/.test(err.message)) return json({ error: "invalid_input", message: err.message }, 400);
  console.error("Unerwarteter Fehler:", err instanceof Error ? err.name : "unbekannt");
  return json({ error: "internal_error" }, 500);
}

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

/** Ungültige oder nicht ganzzahlige IDs in der URL sehen aus wie "nicht gefunden". */
export function intParam(value: string): number {
  if (!/^\d{1,9}$/.test(value)) throw new AppError("not_found", "Nicht gefunden.");
  return Number(value);
}

/** Hängt das Sitzungs-Cookie mit neuer Laufzeit an (gleitender Inaktivitäts-Timeout), außer der Handler setzt selbst eines. */
export function withRefreshedSession(res: Response, token: string): Response {
  if (res.headers.has("set-cookie")) return res;
  const c = ctx();
  const headers = new Headers(res.headers);
  headers.append("Set-Cookie", sessionCookie(token, secureCookies(), c.config.idleSeconds));
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

export interface UserCtx<P> {
  req: Request;
  params: P;
  user: SessionUser;
  session: SessionRow;
  readBody: () => Promise<unknown>;
}

/**
 * Endpunkt für angemeldete Konten: gültige Sitzung UND der Hub lässt das Konto noch zu (der Zugang wird alle paar Minuten
 * neu geprüft); bei schreibenden Methoden zusätzlich Origin- und CSRF-Prüfung. `operator: true` nur für Betreiber.
 */
export function userRoute<P = Record<string, never>>(handler: (a: UserCtx<P>) => unknown | Promise<unknown>, opts: { operator?: boolean } = {}) {
  return async (req: Request, routeCtx: { params: Promise<P> }): Promise<Response> => {
    try {
      const c = ctx();
      const token = readCookie(req, SESSION_COOKIE);
      const auth = await authenticate({ db: c.db, oidc: c.oidc, hub: c.hub, idleSeconds: c.config.idleSeconds }, token);
      if (!auth || !token) return json({ error: "unauthorized" }, 401);
      const { user, session } = auth;
      if (opts.operator && user.role !== "operator") return json({ error: "forbidden" }, 403);
      if (req.method !== "GET" && req.method !== "HEAD") {
        if (!isSameOrigin(req.headers.get("origin"), c.config.baseUrl)) return json({ error: "forbidden" }, 403);
        if (!csrfTokenValid(req.headers.get("x-csrf-token"), session.csrf)) return json({ error: "forbidden" }, 403);
      }
      const out = await handler({ req, params: await routeCtx.params, user, session, readBody: () => readJson(req) });
      return withRefreshedSession(out instanceof Response ? out : json(out), token);
    } catch (err) {
      return errorResponse(err);
    }
  };
}
