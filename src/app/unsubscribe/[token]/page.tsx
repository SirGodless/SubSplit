import { notFound } from "next/navigation";
import ThemeToggle from "@/components/ThemeToggle";
import { readUnsubscribeToken } from "@/lib/mail/tokens";
import { ctx } from "@/lib/server/context";
import UnsubscribeButton from "./UnsubscribeButton";

export const dynamic = "force-dynamic";

const TEXT = { reminders: "Zahlungserinnerungen", prices: "Infos zu Preisänderungen" } as const;

export default async function UnsubscribePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const c = ctx();
  const t = readUnsubscribeToken(c.config.sessionSecret, token);
  if (!t) notFound();
  return (
    <>
      <header className="topbar"><div className="brand">{c.config.appName}</div><ThemeToggle /></header>
      <main className="shell" style={{ paddingTop: 32, maxWidth: 420 }}>
        <h1 className="h" style={{ marginBottom: 8 }}>Abmelden</h1>
        <p className="muted" style={{ marginTop: 0 }}>Du bekommst dann keine {TEXT[t.purpose]} mehr per E-Mail. Du kannst das jederzeit in den Einstellungen wieder einschalten.</p>
        <UnsubscribeButton token={token} />
      </main>
    </>
  );
}
