import { redirect } from "next/navigation";
import { safeNextPath } from "@/lib/nav";
import { getPageUser } from "@/lib/server/auth";
import { ctx } from "@/lib/server/context";

export const dynamic = "force-dynamic";

const MESSAGES: Record<string, string> = {
  state: "Die Anmeldung war abgelaufen oder wurde unterbrochen. Bitte versuche es noch einmal.",
  denied: "Die Anmeldung beim Hub wurde abgebrochen.",
  failed: "Die Anmeldung beim Hub hat nicht geklappt. Bitte versuche es noch einmal.",
  no_access: "Dein Konto hat keinen Zugang zu SubSplit. Bitte den Administrator des Hubs, dir das Recht dafür zu geben.",
  hub_unavailable: "Der Hub ist gerade nicht erreichbar. Bitte versuche es gleich noch einmal.",
  rate_limited: "Zu viele Versuche. Bitte warte ein paar Minuten.",
};

/** Es gibt hier kein Passwortformular: Die Anmeldung läuft über den Hub. Ohne Fehler geht es direkt dorthin. */
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next: rawNext, error } = await searchParams;
  const next = safeNextPath(rawNext);
  if (!error) {
    if (await getPageUser()) redirect(next ?? "/");
    redirect(`/auth/login${next ? `?next=${encodeURIComponent(next)}` : ""}`);
  }
  return (
    <>
      <header className="topbar">
        <div className="brand">{ctx().config.appName}</div>
      </header>
      <main className="shell" style={{ paddingTop: 32, maxWidth: 420 }}>
        <h1 className="h" style={{ marginBottom: 18 }}>Anmelden</h1>
        <p role="alert">{MESSAGES[error] ?? MESSAGES.failed}</p>
        {/* Kein Weiterleiten im Fehlerfall, sonst gäbe es eine Schleife. Mit no_access hilft ein neuer Versuch nicht, der Hub ist dann der Ort. */}
        <p style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {error !== "no_access" && <a className="btn" href={`/auth/login${next ? `?next=${encodeURIComponent(next)}` : ""}`}>Erneut anmelden</a>}
          <a className="btn" href={ctx().config.hub.origin}>Zum Hub</a>
        </p>
      </main>
    </>
  );
}
