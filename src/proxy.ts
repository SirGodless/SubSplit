import { NextResponse } from "next/server";
import { contentSecurityPolicy, hubOriginOf } from "@/lib/security/csp";

/**
 * Setzt die Content-Security-Policy bei jeder Antwort. Das geschieht hier und nicht in next.config.ts, weil die Adresse des
 * Hubs (OIDC_ISSUER) erst beim Start des Containers bekannt ist, die Header der Konfiguration aber beim Bauen feststehen.
 */
export function proxy() {
  const res = NextResponse.next();
  res.headers.set("Content-Security-Policy", contentSecurityPolicy(hubOriginOf(process.env.OIDC_ISSUER)));
  return res;
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
