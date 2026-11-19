import { ctx } from "@/lib/server/context";

export const dynamic = "force-dynamic";

/** Nach dem Abmelden in SubSplit. Im Hub bleibt man angemeldet, deshalb gibt es keinen automatischen Rücksprung zur Anmeldung. */
export default function SignedOut() {
  const c = ctx().config;
  return (
    <>
      <header className="topbar">
        <div className="brand">{c.appName}</div>
      </header>
      <main className="shell" style={{ paddingTop: 32, maxWidth: 420 }}>
        <h1 className="h" style={{ marginBottom: 18 }}>Abgemeldet</h1>
        <p>Du bist in {c.appName} abgemeldet. Im Hub bleibst du angemeldet, dort kannst du dich auch überall abmelden.</p>
        <p style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <a className="btn" href="/auth/login">Wieder anmelden</a>
          <a className="btn" href={c.hub.origin}>Zum Hub</a>
        </p>
      </main>
    </>
  );
}
