import { getDbHandle } from "@/db/client";

export const dynamic = "force-dynamic";

/** Liveness/Readiness. Schreibt nie eine Sicherheits-Logzeile. */
export function GET() {
  try {
    getDbHandle().sqlite.prepare("SELECT 1").get();
    return Response.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ status: "error" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
