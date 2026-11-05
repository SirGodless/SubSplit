import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import AppShell from "@/components/AppShell";
import CopyButton from "@/components/CopyButton";
import PayActions from "@/components/PayActions";
import StandingOrderPanel from "@/components/StandingOrderPanel";
import { addMonths, currentMonth } from "@/lib/billing/month";
import { formatDate, formatEuro, formatMonth, formatPercent } from "@/lib/format";
import { buildPaymentLinks } from "@/lib/pay/links";
import { getPageUser } from "@/lib/server/auth";
import { ctx } from "@/lib/server/context";
import { getPayerView } from "@/lib/services/views";

export const dynamic = "force-dynamic";

export default async function PayPage({ params, searchParams }: { params: Promise<{ recipientId: string }>; searchParams: Promise<{ month?: string }> }) {
  const { recipientId } = await params;
  const auth = await getPageUser();
  if (!auth) redirect(`/login?next=${encodeURIComponent(`/pay/${recipientId}`)}`); // z. B. aus der Erinnerungs-Mail
  const { month: requested } = await searchParams;
  if (!/^\d{1,9}$/.test(recipientId)) notFound();
  const c = ctx();

  let view;
  try {
    view = getPayerView(c.db, auth.user.id, Number(recipientId), typeof requested === "string" ? requested : undefined);
  } catch {
    view = null;
  }
  if (!view) notFound();

  const o = view.outstanding;
  const pay = view.recipientPay;
  const links =
    o.totalCents > 0 && o.referenceId && o.referenceMonth && (pay.iban || pay.paypalMe)
      ? await buildPaymentLinks(
          { name: pay.name, paypalMe: pay.paypalMe, iban: pay.iban, appName: c.config.appName, paypalFormat: c.config.paypalFormat },
          { referenceId: o.referenceId, month: o.referenceMonth, amountCents: o.totalCents, withArrears: o.hasArrears },
        )
      : null;

  return (
    <AppShell user={auth.user} active="/">
      <main className="shell">
        <section style={{ paddingTop: 22 }}>
          <p><Link href="/" className="label">‹ Start</Link></p>
          <p className="label">Zahlung an {view.recipient.displayName}</p>
          <p className="label" style={{ marginTop: 14 }}>{o.totalCents > 0 ? "Jetzt zu überweisen" : "Offen"}</p>
          <div className="total">{formatEuro(o.totalCents)}</div>
          {o.totalCents > 0 ? (
            <p className="muted" style={{ margin: 0 }}>fällig am {formatDate(view.dueDate)}</p>
          ) : view.reportedCents > 0 ? (
            <p style={{ margin: 0 }}><span className="chip chip--marked_paid">Als bezahlt gemeldet</span> <span className="muted">{formatEuro(view.reportedCents)} warten auf Bestätigung</span></p>
          ) : view.expected.totalCents > 0 ? (
            <p style={{ margin: 0 }}><span className="chip chip--confirmed">Dauerauftrag</span> <span className="muted">{formatEuro(view.expected.totalCents)} werden am Fälligkeitstag ({formatDate(view.dueDate)}) automatisch als bezahlt geführt</span></p>
          ) : (
            <p className="muted" style={{ margin: 0 }}>Aktuell ist nichts offen.</p>
          )}
          {o.hasArrears && (
            <div className="notice" style={{ marginTop: 16 }}>
              <p style={{ margin: "0 0 8px", fontWeight: 600 }}>Enthält Rückstand aus Vormonaten</p>
              <div className="rows">
                {o.items.map((i) => (
                  <div key={i.month} className="row" style={{ gridTemplateColumns: "1fr auto", padding: "6px 0" }}>
                    <span className="mono muted">{i.month}</span><span className="mono">{formatEuro(i.amountCents)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        {links && (
          <section className="section" aria-labelledby="pay-h">
            <h2 className="h" id="pay-h">Bezahlen</h2>
            <div className="stack">
              {links.paypal && (
                <a className="btn btn--primary btn--block" href={links.paypal.url} target="_blank" rel="noopener noreferrer">
                  Mit PayPal bezahlen · {formatEuro(o.totalCents)}
                </a>
              )}
              {links.bank && (
                <details className="bank">
                  <summary className="btn btn--block">Per Überweisung bezahlen</summary>
                  <div style={{ marginTop: 12 }}>
                    <div className="kv"><span className="label">Empfänger</span><span className="v">{links.bank.recipientName}</span><span /></div>
                    <div className="kv"><span className="label">IBAN</span><span className="v">{links.bank.iban.replace(/(.{4})/g, "$1 ").trim()}</span><CopyButton value={links.bank.iban} /></div>
                    <div className="kv"><span className="label">Betrag</span><span className="v">{formatEuro(o.totalCents)}</span><span /></div>
                    <div className="kv"><span className="label">Zweck</span><span className="v">{links.remittance}</span><CopyButton value={links.remittance} /></div>
                  </div>
                </details>
              )}
              <div className="qrs">
                {links.paypal && (
                  <figure style={{ margin: 0 }}>
                    <div className="qr" role="img" aria-label="QR-Code für PayPal" dangerouslySetInnerHTML={{ __html: links.paypal.qrSvg }} />
                    <figcaption className="label" style={{ marginTop: 8 }}>PayPal-QR</figcaption>
                  </figure>
                )}
                {links.bank && (
                  <figure style={{ margin: 0 }}>
                    <div className="qr" role="img" aria-label="GiroCode für die Banking-App" dangerouslySetInnerHTML={{ __html: links.bank.giroCodeSvg }} />
                    <figcaption className="label" style={{ marginTop: 8 }}>GiroCode</figcaption>
                  </figure>
                )}
              </div>
              <div className="panel">
                <p className="label">Referenz-ID</p>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, margin: "6px 0 10px" }}>
                  <span className="ref">{links.referenceId}</span>
                  <CopyButton value={links.referenceId} />
                </div>
                <p className="muted" style={{ margin: 0, fontSize: 14 }}>
                  {links.paypal ? "Bitte als Notiz bei PayPal angeben, der Link kann sie nicht vorausfüllen. " : ""}
                  {links.bank ? "Bei einer Überweisung steht sie im Verwendungszweck." : ""}
                </p>
              </div>
              <PayActions recipientId={view.recipient.id} marked={false} />
            </div>
          </section>
        )}
        {!links && view.reportedCents > 0 && (
          <section className="section"><PayActions recipientId={view.recipient.id} marked /></section>
        )}
        {!links && o.totalCents > 0 && (
          <section className="section"><p className="notice">{view.recipient.displayName} hat noch keine Zahlungsdaten hinterlegt. Bitte kurz nachfragen.</p></section>
        )}

        <section className="section" aria-labelledby="so-h">
          <h2 className="h" id="so-h" style={{ marginBottom: 12 }}>Dauerauftrag</h2>
          <StandingOrderPanel payerId={auth.user.id} recipientId={view.recipient.id} active={view.standingOrder?.fromMonth ?? null} thisMonth={currentMonth()} nextMonth={addMonths(currentMonth(), 1)} />
        </section>

        <section className="section" aria-labelledby="split-h">
          <h2 className="h" id="split-h">So setzt sich {formatMonth(view.month)} zusammen</h2>
          {view.months.length > 1 && (
            <nav className="months" aria-label="Monat wählen" style={{ margin: "0 0 18px" }}>
              {view.months.map((m) => (
                <Link key={m} href={`/pay/${view.recipient.id}?month=${m}`} aria-current={m === view.month ? "page" : undefined}>{m}</Link>
              ))}
            </nav>
          )}
          {view.subscriptions.length === 0 ? (
            <p className="muted">In diesem Monat warst du bei {view.recipient.displayName} an keinem Abo beteiligt.</p>
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
                        <span>Rundungsrest ({view.recipient.displayName})</span><span className="w" /><span className="p" /><span className="a">{formatEuro(s.restCents)}</span>
                      </div>
                    )}
                    <div className="row row--sum"><span className="label">Summe = Abo-Preis</span><span className="mono">{formatEuro(s.priceCents)}</span></div>
                  </div>
                </article>
              ))}
              <p className="row row--sum" style={{ borderTop: "2px solid var(--line-strong)", paddingTop: 12 }}><span className="label">Dein Anteil im Monat</span><span className="mono">{formatEuro(view.totalCents)}</span></p>
            </div>
          )}
        </section>

        <p className="muted" style={{ fontSize: 13, marginTop: 32 }}>
          Mitzahler eines Abos sehen gegenseitig Anzeigenamen, Gewichte, Anteile und Beträge innerhalb dieses Abos. Anteile werden auf den vollen Cent abgerundet, ein Rest verbleibt beim Empfänger.
        </p>
      </main>
    </AppShell>
  );
}
