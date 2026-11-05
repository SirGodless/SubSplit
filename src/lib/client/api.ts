/** Kleine Helfer für Client-Komponenten: CSRF-Token, Fehlermeldungen, Weiterleitung bei abgelaufener Sitzung. */
let csrf: string | null = null;

export function setCsrf(token: string | null): void {
  csrf = token;
}

function toLogin(): never {
  if (typeof window !== "undefined") window.location.href = "/login";
  throw new Error("Sitzung abgelaufen");
}

export async function getCsrf(force = false): Promise<string> {
  if (csrf && !force) return csrf;
  const r = await fetch("/api/auth/session");
  if (r.status === 401) toLogin();
  csrf = ((await r.json()) as { csrfToken: string }).csrfToken;
  return csrf;
}

export async function api<T = unknown>(path: string, method = "GET", body?: unknown, retry = true): Promise<T> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (method !== "GET") headers["x-csrf-token"] = await getCsrf();
  const res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  if (res.status === 401) toLogin();
  if (res.status === 403 && method !== "GET" && retry) {
    await getCsrf(true); // Token kann nach Passwortwechsel oder Neuanmeldung veraltet sein
    return api<T>(path, method, body, false);
  }
  const data = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
  if (!res.ok) throw new Error(data.message ?? (res.status === 429 ? "Zu viele Anfragen. Bitte kurz warten." : `Fehler ${res.status}`));
  return data as T;
}
