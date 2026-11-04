import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import CopyButton from "@/components/CopyButton";
import PaidButton from "@/components/PaidButton";
import ThemeToggle from "@/components/ThemeToggle";
import { formatDueDate, formatEuro, formatMonth, formatPercent, STATUS_LABEL } from "@/lib/format";
import { buildPaymentLinks } from "@/lib/pay/links";
import { clientIp, ctx } from "@/lib/server/context";
import { authenticateToken, getParticipantView } from "@/lib/services/participant-view";

export const dynamic = "force-dynamic";

export default async function ParticipantPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ month?: string }> }) {
  const { token } = await params;
  const { month: requested } = await searchParams;
  const c = ctx();
  const h = await headers();
  const ip = clientIp(h);

  if (!c.tokenLimiter.consume(ip)) notFound();
  const auth = authenticateToken(c.db, token, ip, c.logger);
  if (auth.kind !== "ok") notFound(); // unbekannt und widerrufen: identische Seite

  let view;
  try {
    view = getParticipantView(c.db, auth.participantId, typeof requested === "string" ? requested : undefined);
  } catch {
    view = null;
  }
  if (!view) notFound();

  const pay = view.payment;
  const links =
    pay && pay.status !== "confirmed"
      ? await buildPaymentLinks(
          { name: c.config.recipientName, paypalMe: c.config.recipientPaypalMe, iban: c.config.recipientIban, appName: c.config.appName },
          { referenceId: pay.referenceId, month: view.month, amountCents: pay.amountCents },
        )
      : null;

  return (
    <>
      <header className="topbar">
        <div className="brand">{c.config.appName}</div>
        <ThemeToggle />
      </header>
      <main className="shell">
        <section style={{ paddingTop: 22 }}>
          <p className="label">Hallo {view.displayName}</p>
          <p className="label" style={{ marginTop: 18 }}>Monatszahlung · {formatMonth(view.month)}</p>
          <div className="total">{formatEuro(view.totalCents)}</div>
          {pay ? (
            <p style={{ margin: 0, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <span className={`chip chip--${pay.status}`}>{STATUS_LABEL[pay.status]}</span>
              {pay.status !== "confirmed" && <span className="muted">fällig am {formatDueDate(view.month, c.config.dueDay)}</span>}
            </p>
          ) : (
            <p className="muted" style={{ margin: 0 }}>Für diesen Monat ist nichts zu zahlen.</p>
          )}

          {view.months.length > 1 && (
            <nav className="months" aria-label="Monat wählen" style={{ marginTop: 18 }}>
              {view.months.map((m) => (
                <Link key={m} href={`/p/${token}?month=${m}`} aria-current={m === view.month ? "page" : undefined}>{m}</Link>
              ))}
            </nav>
          )}
        </section>

        {pay && links && (
          <section className="section" aria-labelledby="pay-h">
            <h2 className="h" id="pay-h">Bezahlen</h2>
            <div className="stack">
              <a className="btn btn--primary btn--block" href={links.paypalUrl} target="_blank" rel="noopener noreferrer">
                Mit PayPal bezahlen · {formatEuro(pay.amountCents)}
              </a>
              <div className="qrs">
                <figure style={{ margin: 0 }}>
                  <div className="qr" role="img" aria-label="QR-Code für PayPal" dangerouslySetInnerHTML={{ __html: links.paypalQrSvg }} />
                  <figcaption className="label" style={{ marginTop: 8 }}>PayPal-QR</figcaption>
                </figure>
                <figure style={{ margin: 0 }}>
                  <div className="qr" role="img" aria-label="GiroCode für die Banking-App" dangerouslySetInnerHTML={{ __html: links.giroCodeSvg }} />
                  <figcaption className="label" style={{ marginTop: 8 }}>GiroCode</figcaption>
                </figure>
              </div>

              <div className="panel">
                <p className="label">Referenz-ID</p>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, margin: "6px 0 10px" }}>
                  <span className="ref">{links.referenceId}</span>
                  <CopyButton value={links.referenceId} />
                </div>
                <p className="muted" style={{ margin: 0, fontSize: 14 }}>
                  Bitte als Notiz bei PayPal angeben. Der PayPal-Link kann die Notiz nicht vorausfüllen. Beim GiroCode ist sie im Verwendungszweck schon enthalten.
                </p>
              </div>

              <div>
                <p className="label" style={{ marginBottom: 8 }}>Banküberweisung</p>
                <div className="kv"><span className="label">Empfänger</span><span className="v">{links.recipientName}</span><span /></div>
                <div className="kv"><span className="label">IBAN</span><span className="v">{links.iban.replace(/(.{4})/g, "$1 ").trim()}</span><CopyButton value={links.iban} /></div>
                <div className="kv"><span className="label">Betrag</span><span className="v">{formatEuro(pay.amountCents)}</span><span /></div>
                <div className="kv"><span className="label">Zweck</span><span className="v">{links.remittance}</span><CopyButton value={links.remittance} /></div>
              </div>

              <PaidButton token={token} month={view.month} marked={pay.status === "marked_paid"} />
            </div>
          </section>
        )}

        <section className="section" aria-labelledby="split-h">
          <h2 className="h" id="split-h">So setzt sich der Betrag zusammen</h2>
          {view.subscriptions.length === 0 ? (
            <p className="muted">Du bist in diesem Monat an keinem Abo beteiligt.</p>
          ) : (
            <div className="stack" style={{ gap: 28 }}>
              {view.subscriptions.map((s) => (
                <article key={s.name}>
                  <header style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, marginBottom: 8 }}>
                    <h3 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>{s.name}</h3>
                    <span className="label">Preis <span className="mono" style={{ color: "var(--text)", fontSize: 14 }}>{formatEuro(s.priceCents)}</span></span>
                  </header>
                  <div className="rows">
                    <div className="row row--share label" aria-hidden="true"><span>Name</span><span className="w">Gewicht</span><span className="p">Anteil</span><span className="a">Betrag</span></div>
                    {s.lines.map((l, i) => (
                      <div key={i} className={`row row--share${l.isYou ? " row--you" : ""}`}>
                        <span>{l.displayName}{l.isYou ? " (du)" : ""}</span>
                        <span className="w">{l.weight}×</span>
                        <span className="p">{formatPercent(l.percent)}</span>
                        <span className="a">{formatEuro(l.amountCents)}</span>
                      </div>
                    ))}
                    {s.restCents > 0 && (
                      <div className="row row--share muted">
                        <span>Rundungsrest (Admin)</span><span className="w" /><span className="p" /><span className="a">{formatEuro(s.restCents)}</span>
                      </div>
                    )}
                    <div className="row row--sum"><span className="label">Summe = Abo-Preis</span><span className="mono">{formatEuro(s.priceCents)}</span></div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        <p className="muted" style={{ fontSize: 13, marginTop: 32 }}>
          Mitzahler eines Abos sehen gegenseitig Anzeigenamen, Gewichte, Anteile und Beträge innerhalb dieses Abos. Anteile werden auf den vollen Cent abgerundet, ein Rest verbleibt beim Admin.
        </p>
      </main>
    </>
  );
}
