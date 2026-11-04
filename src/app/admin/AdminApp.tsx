"use client";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import CopyButton from "@/components/CopyButton";
import { addMonths, currentMonth } from "@/lib/billing/month";
import { formatDueDate, formatEuro, formatMonth, parseEuro, STATUS_LABEL } from "@/lib/format";

type Status = "open" | "marked_paid" | "confirmed";
interface PaymentRow { paymentId: number; participantId: number; displayName: string; email: string | null; referenceId: string; amountCents: number; status: Status }
interface Overview { month: string; payments: PaymentRow[]; ownerShareCents: number; totals: { open: number; markedPaid: number; confirmed: number }; subscriptions: Array<{ subscriptionId: number; name: string; priceCents: number; restCents: number }> }
interface Sub { id: number; name: string }
interface Price { subscriptionId: number; validFromMonth: string; amountCents: number }
interface Membership { subscriptionId: number; participantId: number; weight: number; validFromMonth: string; validToMonth: string | null }
interface Person { id: number; displayName: string; email: string | null; isOwner: boolean; tokenRevokedAt: string | null }

type Tab = "overview" | "subs" | "people";

export default function AdminApp({ dueDay }: { dueDay: number }) {
  const router = useRouter();
  const thisMonth = useMemo(() => currentMonth(), []);
  const [tab, setTab] = useState<Tab>("overview");
  const [csrf, setCsrf] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [month, setMonth] = useState(thisMonth);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [subs, setSubs] = useState<{ subscriptions: Sub[]; prices: Price[]; memberships: Membership[] } | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [newLink, setNewLink] = useState<{ name: string; link: string } | null>(null);

  const call = useCallback(
    async (path: string, method = "GET", body?: unknown) => {
      const res = await fetch(path, {
        method,
        headers: { "content-type": "application/json", "x-csrf-token": csrf },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (res.status === 401) {
        router.replace("/admin/login");
        throw new Error("Sitzung abgelaufen");
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message ?? data.error ?? `Fehler ${res.status}`);
      return data;
    },
    [csrf, router],
  );

  const guard = useCallback(async (fn: () => Promise<void>, okText?: string): Promise<boolean> => {
    try {
      await fn();
      if (okText) setMsg({ kind: "ok", text: okText });
      return true;
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : "Unbekannter Fehler" });
      return false;
    }
  }, []);

  useEffect(() => {
    fetch("/api/admin/session").then((r) => (r.ok ? r.json() : Promise.reject())).then((d) => setCsrf(d.csrfToken)).catch(() => router.replace("/admin/login"));
  }, [router]);

  const loadOverview = useCallback(() => guard(async () => setOverview(await call(`/api/admin/overview?month=${month}`))), [call, guard, month]);
  const loadSubs = useCallback(() => guard(async () => setSubs(await call("/api/admin/subscriptions"))), [call, guard]);
  const loadPeople = useCallback(() => guard(async () => setPeople((await call("/api/admin/participants")).participants)), [call, guard]);

  useEffect(() => { if (csrf) { loadOverview(); } }, [csrf, loadOverview]);
  useEffect(() => { if (csrf) { loadSubs(); loadPeople(); } }, [csrf, loadSubs, loadPeople]);

  const personName = (id: number) => people.find((p) => p.id === id)?.displayName ?? `#${id}`;
  const hasOwner = people.some((p) => p.isOwner);

  async function logout() {
    await guard(async () => { await call("/api/admin/logout", "POST"); router.replace("/admin/login"); });
  }

  return (
    <main className="shell shell--wide" style={{ paddingTop: 0 }}>
      <nav className="tabs" role="tablist" aria-label="Bereiche">
        {([["overview", "Übersicht"], ["subs", "Abos"], ["people", "Teilnehmer"]] as const).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => { setTab(id); setMsg(null); }}>{label}</button>
        ))}
        <span style={{ flex: 1 }} />
        <button onClick={logout}>Abmelden</button>
      </nav>

      {msg && <p className={`notice${msg.kind === "ok" ? " notice--ok" : ""}`} role={msg.kind === "err" ? "alert" : "status"} style={{ marginTop: 16 }}>{msg.text}</p>}

      {tab === "overview" && (
        <section className="section" style={{ borderTop: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
            <button className="btn btn--small" onClick={() => setMonth(addMonths(month, -1))} aria-label="Vorheriger Monat">‹</button>
            <h2 className="h" style={{ minWidth: 160, textAlign: "center", fontSize: 14 }}>{formatMonth(month)}</h2>
            <button className="btn btn--small" disabled={month >= thisMonth} onClick={() => setMonth(addMonths(month, 1))} aria-label="Nächster Monat">›</button>
            <span className="label" style={{ marginLeft: "auto" }}>Fällig am {formatDueDate(month, dueDay)}</span>
          </div>
          {overview && (
            <>
              <p className="label" style={{ marginBottom: 12 }}>
                Offen {overview.totals.open} · Als bezahlt gemeldet {overview.totals.markedPaid} · Bestätigt {overview.totals.confirmed} · Dein Anteil {formatEuro(overview.ownerShareCents)}
              </p>
              <div className="scroll-x">
                <table className="t">
                  <thead><tr><th>Name</th><th>Referenz</th><th style={{ textAlign: "right" }}>Betrag</th><th>Status</th><th>Aktion</th></tr></thead>
                  <tbody>
                    {overview.payments.length === 0 && <tr><td colSpan={5} className="muted">Keine Monatszahlungen in diesem Monat.</td></tr>}
                    {overview.payments.map((p) => (
                      <tr key={p.paymentId}>
                        <td>{p.displayName}</td>
                        <td className="mono">{p.referenceId}</td>
                        <td className="mono" style={{ textAlign: "right" }}>{formatEuro(p.amountCents)}</td>
                        <td><span className={`chip chip--${p.status}`}>{STATUS_LABEL[p.status]}</span></td>
                        <td>
                          <div className="actions">
                            {p.status !== "confirmed" && <button className="btn btn--small btn--primary" onClick={() => guard(async () => { await call(`/api/admin/payments/${p.paymentId}/status`, "POST", { status: "confirmed" }); await loadOverview(); })}>Bestätigen</button>}
                            {p.status !== "open" && <button className="btn btn--small" onClick={() => guard(async () => { await call(`/api/admin/payments/${p.paymentId}/status`, "POST", { status: "open" }); await loadOverview(); })}>Zurücksetzen</button>}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <h3 className="h" style={{ margin: "28px 0 10px" }}>Abos in diesem Monat</h3>
              <div className="rows">
                {overview.subscriptions.map((s) => (
                  <div key={s.subscriptionId} className="row" style={{ gridTemplateColumns: "1fr auto" }}>
                    <span>{s.name}{s.restCents > 0 && <span className="muted"> · Rundungsrest bei dir: {formatEuro(s.restCents)}</span>}</span>
                    <span className="mono">{formatEuro(s.priceCents)}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>
      )}

      {tab === "subs" && subs && (
        <SubsTab subs={subs} people={people} thisMonth={thisMonth} personName={personName}
          onSubmit={(fn, ok) => guard(async () => { await fn(call); await loadSubs(); await loadOverview(); }, ok)} />
      )}

      {tab === "people" && (
        <section className="section" style={{ borderTop: 0 }}>
          {newLink && (
            <div className="notice notice--ok" style={{ marginBottom: 18 }}>
              <p className="label">Magic-Link für {newLink.name} · wird nur jetzt angezeigt</p>
              <p className="mono" style={{ wordBreak: "break-all", margin: "8px 0" }}>{newLink.link}</p>
              <CopyButton value={newLink.link} label="Link kopieren" />
            </div>
          )}
          <div className="scroll-x">
            <table className="t">
              <thead><tr><th>Name</th><th>E-Mail</th><th>Link</th><th>Aktion</th></tr></thead>
              <tbody>
                {people.map((p) => (
                  <tr key={p.id}>
                    <td>{p.displayName}{p.isOwner && <span className="chip chip--open" style={{ marginLeft: 8 }}>Du</span>}</td>
                    <td className="muted">{p.email ?? "–"}</td>
                    <td>{p.isOwner ? "–" : p.tokenRevokedAt ? <span className="chip chip--open">Gesperrt</span> : <span className="chip chip--confirmed">Aktiv</span>}</td>
                    <td>
                      {!p.isOwner && (
                        <div className="actions">
                          <button className="btn btn--small" onClick={() => guard(async () => { const d = await call(`/api/admin/participants/${p.id}/token`, "POST", { action: "regenerate" }); setNewLink({ name: p.displayName, link: d.link }); await loadPeople(); })}>Neuer Link</button>
                          {!p.tokenRevokedAt && <button className="btn btn--small" onClick={() => guard(async () => { await call(`/api/admin/participants/${p.id}/token`, "POST", { action: "revoke" }); await loadPeople(); }, "Link gesperrt.")}>Sperren</button>}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3 className="h" style={{ margin: "28px 0 12px" }}>Teilnehmer anlegen</h3>
          <form className="stack" style={{ maxWidth: 420 }} onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const form = e.currentTarget;
            guard(async () => {
              const d = await call("/api/admin/participants", "POST", { displayName: f.get("name"), email: (f.get("email") as string) || null, isOwner: f.get("owner") === "on" });
              setNewLink({ name: String(f.get("name")), link: d.link });
              form.reset();
              await loadPeople();
            });
          }}>
            <label className="f"><span className="label">Anzeigename (für Mitzahler sichtbar)</span><input name="name" required maxLength={60} /></label>
            <label className="f"><span className="label">E-Mail (optional, nur intern)</span><input name="email" type="email" autoComplete="off" /></label>
            {!hasOwner && <label style={{ display: "flex", gap: 10, alignItems: "center" }}><input name="owner" type="checkbox" style={{ width: 20, minHeight: 20 }} /><span>Das bin ich (Empfänger, bekommt keine Zahlung)</span></label>}
            <button className="btn btn--primary">Anlegen</button>
          </form>
        </section>
      )}
    </main>
  );
}

type Call = (path: string, method?: string, body?: unknown) => Promise<unknown>;

function SubsTab({ subs, people, thisMonth, personName, onSubmit }: {
  subs: { subscriptions: Sub[]; prices: Price[]; memberships: Membership[] }; people: Person[]; thisMonth: string;
  personName: (id: number) => string; onSubmit: (fn: (call: Call) => Promise<unknown>, ok: string) => Promise<boolean>;
}) {
  // null = Liste, "new" = Formular für neues Abo, Zahl = Verwaltung dieses Abos
  const [view, setView] = useState<number | "new" | null>(null);
  const [person, setPerson] = useState<string>("");
  const [weight, setWeight] = useState<string>("1");

  const pricesOf = (id: number) => subs.prices.filter((p) => p.subscriptionId === id).sort((a, b) => b.validFromMonth.localeCompare(a.validFromMonth));
  const priceNow = (id: number) => pricesOf(id).find((p) => p.validFromMonth <= thisMonth)?.amountCents ?? null;
  const activeCount = (id: number) =>
    subs.memberships.filter((m) => m.subscriptionId === id && m.validFromMonth <= thisMonth && (m.validToMonth === null || m.validToMonth >= thisMonth)).length;
  const euro = (v: FormDataEntryValue | null) => {
    const c = parseEuro(String(v ?? ""));
    if (c === null) throw new Error("Preis bitte als Zahl eingeben, z. B. 12,99.");
    return c;
  };
  const monthField = (name: string, def: string, label: string) => (
    <label className="f"><span className="label">{label}</span><input name={name} defaultValue={def} pattern="\d{4}-(0[1-9]|1[0-2])" placeholder="JJJJ-MM" required /></label>
  );
  const submit = (fn: (f: FormData, call: Call) => Promise<unknown>, ok: string, after?: () => void) => (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    void onSubmit((call) => fn(f, call), ok).then((done) => { if (done) after?.(); });
  };

  // ---------- Neues Abo ----------
  if (view === "new") {
    return (
      <section className="section" style={{ borderTop: 0 }}>
        <button className="btn btn--small" onClick={() => setView(null)}>‹ Alle Abos</button>
        <h2 className="h" style={{ margin: "20px 0 14px" }}>Neues Abo</h2>
        <form className="stack" style={{ maxWidth: 420 }} onSubmit={submit(
          async (f, call) => call("/api/admin/subscriptions", "POST", { name: f.get("name"), priceCents: euro(f.get("price")), validFromMonth: f.get("from") }),
          "Abo angelegt.", () => setView(null))}>
          <label className="f"><span className="label">Name</span><input name="name" required maxLength={60} autoFocus /></label>
          <label className="f"><span className="label">Preis pro Monat (EUR)</span><input name="price" inputMode="decimal" required placeholder="12,99" /></label>
          {monthField("from", thisMonth, "Gültig ab (Monat)")}
          <button className="btn btn--primary">Abo anlegen</button>
        </form>
      </section>
    );
  }

  // ---------- Verwaltung eines Abos ----------
  const sub = typeof view === "number" ? subs.subscriptions.find((s) => s.id === view) : undefined;
  if (sub) {
    const members = subs.memberships.filter((m) => m.subscriptionId === sub.id).sort((a, b) => a.participantId - b.participantId || a.validFromMonth.localeCompare(b.validFromMonth));
    const state = (m: Membership) =>
      m.validToMonth !== null && m.validToMonth < thisMonth ? { label: "Beendet", cls: "chip--open" }
      : m.validFromMonth > thisMonth ? { label: `Ab ${m.validFromMonth}`, cls: "chip--marked_paid" }
      : { label: "Aktiv", cls: "chip--confirmed" };
    const now = priceNow(sub.id);
    return (
      <section className="section" style={{ borderTop: 0 }}>
        <button className="btn btn--small" onClick={() => setView(null)}>‹ Alle Abos</button>
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, margin: "20px 0 4px", flexWrap: "wrap" }}>
          <h2 style={{ margin: 0, fontSize: 26 }}>{sub.name}</h2>
          <span className="mono">{now === null ? "kein Preis" : formatEuro(now)} <span className="muted">/ Monat</span></span>
        </header>

        <div className="section">
          <h3 className="h">Preis</h3>
          <div className="rows" style={{ margin: "12px 0 18px" }}>
            {pricesOf(sub.id).map((p) => (
              <div key={p.validFromMonth} className="row" style={{ gridTemplateColumns: "1fr auto" }}>
                <span className="mono muted">ab {p.validFromMonth}</span><span className="mono">{formatEuro(p.amountCents)}</span>
              </div>
            ))}
          </div>
          <form className="grid2 grid2--stack" style={{ alignItems: "end" }} onSubmit={submit(
            async (f, call) => call(`/api/admin/subscriptions/${sub.id}/prices`, "POST", { validFromMonth: f.get("from"), priceCents: euro(f.get("price")) }), "Preis gespeichert.")}>
            <label className="f"><span className="label">Neuer Preis (EUR)</span><input name="price" inputMode="decimal" required placeholder="14,99" /></label>
            {monthField("from", thisMonth, "Gültig ab (Monat)")}
            <button className="btn">Preis ändern</button>
          </form>
        </div>

        <div className="section">
          <h3 className="h">Beteiligte</h3>
          {members.length === 0 ? <p className="muted">Noch niemand beteiligt.</p> : (
            <div className="rows" style={{ margin: "12px 0 18px" }}>
              {members.map((m, i) => {
                const st = state(m);
                return (
                  <button key={i} type="button" className="listbtn" onClick={() => { setPerson(String(m.participantId)); setWeight(String(m.weight)); }}
                    aria-label={`${personName(m.participantId)} in das Formular übernehmen`}>
                    <span style={{ fontWeight: 600 }}>{personName(m.participantId)}</span>
                    <span className="mono muted">{m.weight}× · {m.validFromMonth} – {m.validToMonth ?? "offen"}</span>
                    <span className={`chip ${st.cls}`}>{st.label}</span>
                  </button>
                );
              })}
            </div>
          )}
          {people.length > 0 && (
            <div className="grid2 grid2--stack" style={{ gap: 28 }}>
              <form className="stack" onSubmit={submit(
                async (f, call) => call("/api/admin/memberships", "PUT", { subscriptionId: sub.id, participantId: Number(person), weight: Number(weight), from: f.get("from") }), "Beteiligung gespeichert.")}>
                <h4 className="h">Beteiligung setzen / Gewicht ändern</h4>
                <label className="f"><span className="label">Teilnehmer</span>
                  <select value={person} onChange={(e) => setPerson(e.target.value)} required>
                    <option value="" disabled>Bitte wählen</option>
                    {people.map((p) => <option key={p.id} value={p.id}>{p.displayName}</option>)}
                  </select></label>
                <label className="f"><span className="label">Gewicht (1 = gleicher Anteil)</span>
                  <input type="number" min={1} max={1000} value={weight} onChange={(e) => setWeight(e.target.value)} required /></label>
                {monthField("from", thisMonth, "Ab Monat")}
                <button className="btn btn--primary">Speichern</button>
              </form>
              <form className="stack" onSubmit={submit(
                async (f, call) => call("/api/admin/memberships/end", "POST", { subscriptionId: sub.id, participantId: Number(person), lastMonth: f.get("last") }), "Beteiligung beendet.")}>
                <h4 className="h">Beteiligung beenden</h4>
                <p className="muted" style={{ margin: 0, fontSize: 14 }}>Gilt für den links gewählten Teilnehmer. Du kannst auch eine Zeile oben anklicken.</p>
                {monthField("last", thisMonth, "Letzter Monat der Beteiligung")}
                <button className="btn" disabled={!person}>Beenden</button>
              </form>
            </div>
          )}
        </div>
      </section>
    );
  }

  // ---------- Liste ----------
  return (
    <section className="section" style={{ borderTop: 0 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, gap: 12 }}>
        <h2 className="h">Alle Abos</h2>
        <button className="btn btn--primary btn--small" onClick={() => setView("new")}>+ Neues Abo</button>
      </div>
      {subs.subscriptions.length === 0 ? <p className="muted">Noch keine Abos angelegt.</p> : (
        <div className="rows">
          {subs.subscriptions.map((s) => (
            <button key={s.id} type="button" className="listbtn listbtn--sub" onClick={() => { setView(s.id); setPerson(""); setWeight("1"); }}>
              <span style={{ fontWeight: 700, fontSize: 18 }}>{s.name}</span>
              <span className="muted mono">{activeCount(s.id)} {activeCount(s.id) === 1 ? "Beteiligter" : "Beteiligte"}</span>
              <span className="mono">{priceNow(s.id) === null ? "–" : formatEuro(priceNow(s.id)!)}<span className="muted"> / Monat</span></span>
              <span aria-hidden="true" className="accent">›</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
