import { headers } from "next/headers";
import { notFound } from "next/navigation";
import ThemeToggle from "@/components/ThemeToggle";
import { clientIp, ctx } from "@/lib/server/context";
import { peekEmailVerification } from "@/lib/services/email";
import ConfirmButton from "./ConfirmButton";

export const dynamic = "force-dynamic";

export default async function VerifyEmailPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const c = ctx();
  const ip = clientIp(await headers());
  if (!c.tokenLimiter.consume(ip)) notFound();
  if (!peekEmailVerification(c.db, token, ip, c.logger)) notFound();
  return (
    <>
      <header className="topbar"><div className="brand">{c.config.appName}</div><ThemeToggle /></header>
      <main className="shell" style={{ paddingTop: 32, maxWidth: 420 }}>
        <h1 className="h" style={{ marginBottom: 8 }}>E-Mail-Adresse bestätigen</h1>
        <p className="muted" style={{ marginTop: 0 }}>Bestätige, dass diese Adresse zu deinem Konto gehört. Danach bekommst du Erinnerungen und Infos per E-Mail.</p>
        <ConfirmButton token={token} />
      </main>
    </>
  );
}
