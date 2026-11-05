import Link from "next/link";
import { redirect } from "next/navigation";
import AppShell from "@/components/AppShell";
import LeaveButton from "@/components/LeaveButton";
import { formatDate, formatEuro, formatMonth } from "@/lib/format";
import { getPageUser } from "@/lib/server/auth";
import { ctx } from "@/lib/server/context";
import { getHome } from "@/lib/services/views";

export const dynamic = "force-dynamic";

export default async function Home() {
  const auth = await getPageUser();
  if (!auth) redirect("/login");
  const home = getHome(ctx().db, auth.user.id);
  if (!home) redirect("/login");

  return (
    <AppShell user={auth.user} active="/">
      <main className="shell">
        <section style={{ paddingTop: 22 }}>
          <p className="label">Hallo {home.displayName}</p>
          <p className="label" style={{ marginTop: 18 }}>Offen insgesamt · {formatMonth(home.month)}</p>
          <div className="total">{formatEuro(home.totalOutstandingCents)}</div>
          {home.totalReportedCents > 0 && (
            <p className="muted" style={{ margin: 0 }}>{formatEuro(home.totalReportedCents)} als bezahlt gemeldet, wartet auf Bestätigung.</p>
          )}
          {home.payments.length === 0 && <p className="muted" style={{ margin: 0 }}>Aktuell ist nichts zu zahlen.</p>}
        </section>

        {home.payments.length > 0 && (
          <section className="section" aria-labelledby="pay-h">
            <h2 className="h" id="pay-h">Zu zahlen</h2>
            <div className="stack">
              {home.payments.map((p) => (
                <Link key={p.recipientId} href={`/pay/${p.recipientId}`} className="paycard">
                  <span className="name">{p.recipientName}</span>
                  <span className="amt">{formatEuro(p.outstandingCents)}</span>
                  <span className="muted" style={{ fontSize: 14 }}>
                    {p.outstandingCents > 0 ? `fällig am ${formatDate(p.dueDate)}` : p.expectedCents > 0 ? `Dauerauftrag: ${formatEuro(p.expectedCents)} werden automatisch bestätigt` : "wartet auf Bestätigung"}
                    {p.arrearsCents > 0 && <span className="accent"> · inkl. {formatEuro(p.arrearsCents)} Rückstand</span>}
                  </span>
                  <span className="label" style={{ textAlign: "right" }}>{p.outstandingCents > 0 ? "Bezahlen ›" : "Ansehen ›"}</span>
                </Link>
              ))}
            </div>
          </section>
        )}

        <section className="section" aria-labelledby="subs-h">
          <h2 className="h" id="subs-h">Meine Abos</h2>
          {home.subscriptions.length === 0 ? (
            <p className="muted">Du bist an keinem Abo beteiligt.</p>
          ) : (
            <div className="rows">
              {home.subscriptions.map((s) => (
                <div key={s.id} className="row" style={{ gridTemplateColumns: "1fr auto", alignItems: "center", padding: "14px 0" }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 17 }}>{s.name}</div>
                    <div className="muted" style={{ fontSize: 14 }}>
                      von {s.ownerName} · Gewicht {s.weight}×
                      {s.state === "upcoming" && ` · ab ${s.from}`}
                      {s.state === "ending" && <span className="accent"> · endet nach {s.to}</span>}
                    </div>
                  </div>
                  {s.leave && s.state !== "ending" && <LeaveButton id={s.id} name={s.name} effectiveMonth={s.leave.effectiveMonth} />}
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </AppShell>
  );
}
