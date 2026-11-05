import { headers } from "next/headers";
import { notFound } from "next/navigation";
import ThemeToggle from "@/components/ThemeToggle";
import { clientIp, ctx } from "@/lib/server/context";
import { peekSetupToken } from "@/lib/services/users";
import SetupForm from "./SetupForm";

export const dynamic = "force-dynamic";

export default async function SetupPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const c = ctx();
  const ip = clientIp(await headers());
  if (!c.tokenLimiter.consume(ip)) notFound();
  const found = peekSetupToken(c.db, token, ip, c.logger);
  if (found.kind !== "ok") notFound(); // unbekannt, abgelaufen, verbraucht: gleiche Seite
  return (
    <>
      <header className="topbar">
        <div className="brand">{c.config.appName}</div>
        <ThemeToggle />
      </header>
      <main className="shell" style={{ paddingTop: 32, maxWidth: 420 }}>
        <h1 className="h" style={{ marginBottom: 8 }}>Konto einrichten</h1>
        <p className="muted" style={{ marginTop: 0 }}>Hallo {found.displayName}. Dein Benutzername ist <span className="mono" style={{ color: "var(--text)" }}>{found.username}</span>. Lege jetzt dein Passwort fest.</p>
        <SetupForm token={token} />
      </main>
    </>
  );
}
