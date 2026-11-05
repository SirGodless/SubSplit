import { ZodError } from "zod";
import { csrfTokenValid, isSameOrigin } from "@/lib/security/csrf";
import { refreshSession, SESSION_COOKIE, sessionCookie, verifySession, type SessionPayload } from "@/lib/security/session";
import { AdminError } from "@/lib/services/admin";
import { ctx } from "./context";

export const NO_STORE = { "Cache-Control": "no-store" };

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(data, { status, headers: { ...NO_STORE, ...headers } });
}

/** Einheitliche Antwort für unbekannte UND widerrufene Links. */
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
  if (err instanceof ZodError) return json({ error: "invalid_input", issues: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })) }, 400);
  if (err instanceof AdminError) return json({ error: err.code, message: err.message }, err.code === "not_found" ? 404 : err.code === "not_allowed" ? 409 : 400);
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

export interface AdminCtx<P> {
  req: Request;
  params: P;
  session: SessionPayload;
  readBody: () => Promise<unknown>;
}

/** Admin-Endpunkt: gültige Session; bei schreibenden Methoden zusätzlich Origin- und CSRF-Prüfung. */
export function adminRoute<P = Record<string, never>>(handler: (a: AdminCtx<P>) => unknown | Promise<unknown>) {
  return async (req: Request, routeCtx: { params: Promise<P> }): Promise<Response> => {
    try {
      const c = ctx();
      const session = verifySession(readCookie(req, SESSION_COOKIE), c.config.sessionSecret);
      if (!session) return json({ error: "unauthorized" }, 401);
      if (req.method !== "GET" && req.method !== "HEAD") {
        if (!isSameOrigin(req.headers.get("origin"), c.config.baseUrl)) return json({ error: "forbidden" }, 403);
        if (!csrfTokenValid(req.headers.get("x-csrf-token"), session.csrf)) return json({ error: "forbidden" }, 403);
      }
      const out = await handler({ req, params: await routeCtx.params, session, readBody: () => readJson(req) });
      const res = out instanceof Response ? out : json(out);
      // Gleitende Sitzung: jede gültige Admin-Anfrage verlängert um den Inaktivitäts-Timeout (außer der Handler setzt selbst ein Cookie, z. B. Logout).
      if (res.headers.has("set-cookie")) return res;
      const headers = new Headers(res.headers);
      headers.append("Set-Cookie", sessionCookie(refreshSession(session, c.config.sessionSecret, Date.now(), c.config.adminIdleSeconds), c.config.baseUrl.startsWith("https:"), c.config.adminIdleSeconds));
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
    } catch (err) {
      return errorResponse(err);
    }
  };
}
