/**
 * Erlaubt nur Ziele INNERHALB der App nach dem Login (kein Open Redirect): ein einzelner führender Schrägstrich, keine
 * "//host", keine Backslashes, keine Zeilenumbrüche, nicht die Login-Seite selbst.
 */
export function safeNextPath(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 200) return null;
  if (!raw.startsWith("/") || raw.startsWith("//") || /[\\\r\n\t\0]/.test(raw)) return null;
  if (raw === "/login" || raw.startsWith("/login?")) return null;
  try {
    const u = new URL(raw, "https://app.invalid");
    if (u.origin !== "https://app.invalid") return null;
  } catch {
    return null;
  }
  return raw;
}
