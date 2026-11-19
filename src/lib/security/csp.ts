/**
 * Content-Security-Policy. `frame-ancestors` erlaubt genau eine Herkunft, den Hub: Er darf SubSplit in einem Rahmen anzeigen
 * (Öffnungsmodus "embedded"). Jede andere Seite darf es nicht. Ohne gültige Hub-Adresse bleibt das Einbetten verboten.
 */
export function hubOriginOf(issuer: string | undefined): string | null {
  try {
    const u = new URL((issuer ?? "").trim());
    return u.protocol === "https:" || u.protocol === "http:" ? u.origin : null;
  } catch {
    return null;
  }
}

// 'unsafe-inline' für Skripte/Styles ist vorläufig, weil Next.js Inline-Skripte für die Hydration nutzt.
export function contentSecurityPolicy(hubOrigin: string | null): string {
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "connect-src 'self'",
    `frame-ancestors ${hubOrigin ?? "'none'"}`,
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
}
