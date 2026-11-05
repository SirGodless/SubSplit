import { headers } from "next/headers";
import { notFound } from "next/navigation";
import ThemeToggle from "@/components/ThemeToggle";
import { clientIp, ctx } from "@/lib/server/context";
import { peekInvitation } from "@/lib/services/invitations";
import InviteForm from "./InviteForm";

export const dynamic = "force-dynamic";

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const c = ctx();
  const ip = clientIp(await headers());
  if (!c.tokenLimiter.consume(ip)) notFound();
  if (!peekInvitation(c.db, token, ip, c.logger, c.config.invite)) notFound(); // unbekannt, abgelaufen, eingelöst, widerrufen: gleiche Seite
  return (
    <>
      <header className="topbar">
        <div className="brand">{c.config.appName}</div>
        <ThemeToggle />
      </header>
      <main className="shell" style={{ paddingTop: 32, maxWidth: 420 }}>
        <h1 className="h" style={{ marginBottom: 8 }}>Konto erstellen</h1>
        <p className="muted" style={{ marginTop: 0 }}>Du wurdest eingeladen. Wähle deinen Benutzernamen, deinen Anzeigenamen und ein Passwort.</p>
        <InviteForm token={token} />
      </main>
    </>
  );
}
