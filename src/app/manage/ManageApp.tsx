"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/client/api";
import { addMonths, currentMonth } from "@/lib/billing/month";
import { formatDate, formatEuro, formatMonth, parseEuro, STATUS_LABEL } from "@/lib/format";
import type { ManageData, OwnerOverview } from "@/lib/services/views";

interface DirUser { id: number; displayName: string; username: string }
type Tab = "overview" | "subs";
type Msg = { kind: "ok" | "err"; text: string } | null;

export default function ManageApp({ selfId }: { selfId: number }) {
  const thisMonth = useMemo(() => currentMonth(), []);
  const [tab, setTab] = useState<Tab>("overview");
  const [msg, setMsg] = useState<Msg>(null);
  const [month, setMonth] = useState(thisMonth);
  const [overview, setOverview] = useState<OwnerOverview | null>(null);
  const [data, setData] = useState<ManageData | null>(null);
  const [directory, setDirectory] = useState<DirUser[]>([]);
  const [dueDay, setDueDay] = useState(1);

  const guard = useCallback(async (fn: () => Promise<void>, ok?: string): Promise<boolean> => {
    try {
      await fn();
      if (ok) setMsg({ kind: "ok", text: ok });
      return true;
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : "Unbekannter Fehler" });
      return false;
    }
  }, []);

  const loadOverview = useCallback(() => guard(async () => setOverview(await api<OwnerOverview>(`/api/manage/overview?month=${month}`))), [guard, month]);
  const loadData = useCallback(() => guard(async () => setData(await api<ManageData>("/api/manage/subscriptions"))), [guard]);
  const loadDirectory = useCallback(() => guard(async () => setDirectory((await api<{ users: DirUser[] }>("/api/manage/directory")).users)), [guard]);

  useEffect(() => { void loadData(); void loadDirectory(); api<{ dueDay: number }>("/api/me/profile").then((p) => setDueDay(p.dueDay)).catch(() => {}); }, [loadData, loadDirectory]);
  useEffect(() => { void loadOverview(); }, [loadOverview]);

  const empty = data && data.subscriptions.length === 0;

  return (
    <main className="shell shell--wide" style={{ paddingTop: 0 }}>
      <nav className="tabs" role="tablist" aria-label="Bereiche">
        {([["overview", "Übersicht"], ["subs", "Abos"]] as const).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => { setTab(id); setMsg(null); if (id === "overview") void loadOverview(); else { void loadData(); void loadDirectory(); } }}>{label}</button>
        ))}
      </nav>
      {msg && <p className={`notice${msg.kind === "ok" ? " notice--ok" : ""}`} role={msg.kind === "err" ? "alert" : "status"} style={{ marginTop: 16 }}>{msg.text}</p>}
      {data && !data.canOwn && (
        <p className="notice" style={{ marginTop: 16 }}>Um selbst Abos anzulegen und Geld zu bekommen, trage zuerst in den <Link href="/settings" style={{ textDecoration: "underline" }}>Einstellungen</Link> mindestens IBAN oder PayPal.Me ein.</p>
      )}

      {tab === "overview" && (
        <section className="section" style={{ borderTop: 0 }}>
          {empty ? <p className="muted">Du hast noch keine Abos. Lege im Tab „Abos“ dein erstes an.</p> : (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
                <button className="btn btn--small" onClick={() => setMonth(addMonths(month, -1))} aria-label="Vorheriger Monat">‹</button>
                <h2 className="h" style={{ minWidth: 160, textAlign: "center", fontSize: 14 }}>{formatMonth(month)}</h2>
                <button className="btn btn--small" disabled={month >= thisMonth} onClick={() => setMonth(addMonths(month, 1))} aria-label="Nächster Monat">›</button>
                <span className="label" style={{ marginLeft: "auto" }}>Fällig am {formatDate(`${month}-${String(dueDay).padStart(2, "0")}`)}</span>
              </div>
              {overview && <OverviewBody overview={overview} reload={() => void loadOverview()} guard={guard} selfId={selfId} thisMonth={thisMonth} />}
            </>
          )}
        </section>
      )}

      {tab === "subs" && data && (
        <SubsTab data={data} directory={directory} thisMonth={thisMonth} selfId={selfId} onRefresh={() => { void loadData(); void loadDirectory(); }}
          onSubmit={(fn, ok) => guard(async () => { await fn(); await loadData(); await loadOverview(); }, ok)} />
      )}
    </main>
  );
}

function OverviewBody({ overview, reload, guard, selfId, thisMonth }: { overview: OwnerOverview; reload: () => void; guard: (fn: () => Promise<void>, ok?: string) => Promise<boolean>; selfId: number; thisMonth: string }) {
  const t = overview.totals;
  const setStatus = (id: number, status: string) => void guard(async () => { await api(`/api/manage/payments/${id}/status`, "POST", { status }); reload(); });
  const setOrder = (payerId: number, on: boolean) => void guard(async () => { await api("/api/standing-orders", "POST", { payerUserId: payerId, recipientUserId: selfId, fromMonth: on ? thisMonth : null }); reload(); }, on ? "Dauerauftrag eingeschaltet." : "Dauerauftrag ausgeschaltet.");
  return (
    <>
      <div className="stats">
        <div><div className="label">Gesamtkosten</div><div className="v">{formatEuro(t.totalCostCents)}</div></div>
        <div><div className="label">Von Mitzahlern</div><div className="v">{formatEuro(t.dueCents)}</div></div>
        <div><div className="label">Bestätigt</div><div className="v">{formatEuro(t.confirmedCents)}</div></div>
        <div><div className="label">Gemeldet</div><div className="v">{formatEuro(t.reportedCents)}</div></div>
        <div><div className="label">Noch offen</div><div className="v accent">{formatEuro(t.openCents)}</div></div>
        <div><div className="label">Dein Anteil</div><div className="v">{formatEuro(t.ownShareCents)}</div></div>
      </div>
      <div className="scroll-x">
        <table className="t">
          <thead><tr><th>Name</th><th>Referenz</th><th style={{ textAlign: "right" }}>Betrag</th><th>Status</th><th>Aktion</th></tr></thead>
          <tbody>
            {overview.payments.length === 0 && <tr><td colSpan={5} className="muted">Keine Monatszahlungen in diesem Monat.</td></tr>}
            {overview.payments.map((p) => (
              <tr key={p.paymentId}>
                <td>{p.payerName}{p.arrearsCents > 0 && <div className="accent" style={{ fontSize: 12 }}>+ {formatEuro(p.arrearsCents)} Rückstand</div>}{p.standingOrder && <div className="muted" style={{ fontSize: 12 }}>Dauerauftrag ab {p.standingOrder}</div>}</td>
                <td className="mono">{p.referenceId}</td>
                <td className="mono" style={{ textAlign: "right" }}>{formatEuro(p.amountCents)}</td>
                <td><span className={`chip chip--${p.status}`}>{p.viaStandingOrder ? "Per Dauerauftrag bestätigt" : STATUS_LABEL[p.status]}</span></td>
                <td>
                  <div className="actions">
                    {p.status !== "confirmed" && <button className="btn btn--small btn--primary" onClick={() => setStatus(p.paymentId, "confirmed")}>Bestätigen</button>}
                    {p.status !== "open" && <button className="btn btn--small" onClick={() => setStatus(p.paymentId, "open")}>Zurücksetzen</button>}
                    <button className="btn btn--small" onClick={() => setOrder(p.payerId, !p.standingOrder)}>{p.standingOrder ? "Dauerauftrag aus" : "Dauerauftrag an"}</button>
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
        <div className="row row--sum" style={{ gridTemplateColumns: "1fr auto" }}><span className="label">Summe</span><span className="mono">{formatEuro(t.totalCostCents)}</span></div>
      </div>

      <h3 className="h" style={{ margin: "28px 0 10px" }}>Verlauf</h3>
      <div className="scroll-x">
        <table className="t">
          <thead><tr><th>Monat</th><th style={{ textAlign: "right" }}>Kosten</th><th style={{ textAlign: "right" }}>Von Mitzahlern</th><th style={{ textAlign: "right" }}>Bestätigt</th><th style={{ textAlign: "right" }}>Gemeldet</th><th style={{ textAlign: "right" }}>Offen</th></tr></thead>
          <tbody>
            {[...overview.history].reverse().map((h) => (
              <tr key={h.month}>
                <td className="mono">{h.month}</td>
                <td className="mono" style={{ textAlign: "right" }}>{formatEuro(h.totalCostCents)}</td>
                <td className="mono" style={{ textAlign: "right" }}>{formatEuro(h.dueCents)}</td>
                <td className="mono" style={{ textAlign: "right" }}>{formatEuro(h.confirmedCents)}</td>
                <td className="mono" style={{ textAlign: "right" }}>{formatEuro(h.reportedCents)}</td>
                <td className="mono" style={{ textAlign: "right" }}>{formatEuro(h.openCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function SubsTab({ data, directory, thisMonth, selfId, onSubmit, onRefresh }: {
  data: ManageData; directory: DirUser[]; thisMonth: string; selfId: number;
  onSubmit: (fn: () => Promise<unknown>, ok: string) => Promise<boolean>; onRefresh: () => void;
}) {
  const nextMonth = data.nextMonth;
  const newStart = data.newStartMonth;
  const [showArchived, setShowArchived] = useState(false);
  // null = Liste, "new" = Formular für neues Abo, Zahl = Verwaltung dieses Abos
  const [view, setView] = useState<number | "new" | null>(null);
  const [person, setPerson] = useState("");
  const [weight, setWeight] = useState("1");
  const [filter, setFilter] = useState("");
  // Neu eingetragene Mitzahler, die erst im Folgemonat starten (Zahlungen des laufenden Monats existieren schon)
  const pendingNew = data.memberships.filter((m) =>
    m.validFromMonth === nextMonth &&
    !data.memberships.some((o) => o !== m && o.subscriptionId === m.subscriptionId && o.userId === m.userId && o.validFromMonth <= thisMonth && (o.validToMonth === null || o.validToMonth >= thisMonth)) &&
    data.prices.some((p) => p.subscriptionId === m.subscriptionId && p.validFromMonth <= thisMonth),
  );
  const infoNote = (
    <>
      <p className="notice" style={{ marginBottom: 16 }}>
        Änderungen an Bestehendem (Preis, Gewicht, Beenden) gelten erst ab dem Folgemonat (<b>{nextMonth}</b>), der laufende Monat bleibt fest.
        Neue Abos und neue Mitzahler können ab <b>{newStart}</b> starten{newStart > thisMonth ? " (für den laufenden Monat sind schon Zahlungen angelegt)" : ""}.
      </p>
      {pendingNew.length > 0 && (
        <div className="notice" style={{ marginBottom: 16 }}>
          <p style={{ marginTop: 0 }}>
            <b>{pendingNew.map((m) => m.displayName).filter((n, i, a) => a.indexOf(n) === i).join(", ")}</b> startet erst im Folgemonat. Du kannst sie schon in den laufenden Monat einrechnen:
            Ihr Anteil wird fällig, die noch <b>offenen</b> Beträge der anderen sinken entsprechend. Schon als bezahlt gemeldete oder bestätigte Beträge bleiben unverändert (ein Unterschied wird nicht verrechnet).
          </p>
          <button className="btn btn--small" onClick={() => {
            if (window.confirm("Neue Mitzahler jetzt in den laufenden Monat einrechnen? Offene Beträge der anderen ändern sich.")) void onSubmit(() => api("/api/manage/memberships/include-now", "POST"), "Neue Zahler sind im laufenden Monat eingerechnet.");
          }}>Im laufenden Monat einrechnen</button>
        </div>
      )}
    </>
  );

  const pricesOf = (id: number) => data.prices.filter((p) => p.subscriptionId === id).sort((a, b) => b.validFromMonth.localeCompare(a.validFromMonth));
  const priceNow = (id: number) => pricesOf(id).find((p) => p.validFromMonth <= thisMonth)?.amountCents ?? null;
  const activeCount = (id: number) => data.memberships.filter((m) => m.subscriptionId === id && m.validFromMonth <= thisMonth && (m.validToMonth === null || m.validToMonth >= thisMonth)).length;
  const euro = (v: FormDataEntryValue | null) => {
    const c = parseEuro(String(v ?? ""));
    if (c === null) throw new Error("Preis bitte als Zahl eingeben, z. B. 12,99.");
    return c;
  };
  const monthField = (name: string, def: string, label: string) => (
    <label className="f"><span className="label">{label}</span><input key={`${name}-${def}`} name={name} defaultValue={def} pattern="\d{4}-(0[1-9]|1[0-2])" placeholder="JJJJ-MM" required /></label>
  );
  const submit = (fn: (f: FormData) => Promise<unknown>, ok: string, after?: () => void) => (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    void onSubmit(() => fn(f), ok).then((done) => { if (done) after?.(); });
  };

  // ---------- Neues Abo ----------
  if (view === "new") {
    return (
      <section className="section" style={{ borderTop: 0 }}>
        <button className="btn btn--small" onClick={() => { setView(null); onRefresh(); }}>‹ Alle Abos</button>
        <h2 className="h" style={{ margin: "20px 0 14px" }}>Neues Abo</h2>
        {infoNote}
        {!data.canOwn && <p className="notice" style={{ marginBottom: 16 }}>Bitte zuerst in den <Link href="/settings" style={{ textDecoration: "underline" }}>Einstellungen</Link> mindestens IBAN oder PayPal.Me eintragen.</p>}
        <form className="stack" style={{ maxWidth: 420 }} onSubmit={submit(
          async (f) => api("/api/manage/subscriptions", "POST", { name: f.get("name"), priceCents: euro(f.get("price")), validFromMonth: f.get("from") }),
          "Abo angelegt.", () => setView(null))}>
          <label className="f"><span className="label">Name</span><input name="name" required maxLength={60} autoFocus /></label>
          <label className="f"><span className="label">Preis pro Monat (EUR)</span><input name="price" inputMode="decimal" required placeholder="12,99" /></label>
          {monthField("from", newStart, "Gültig ab (Monat)")}
          <button className="btn btn--primary" disabled={!data.canOwn}>Abo anlegen</button>
        </form>
      </section>
    );
  }

  // ---------- Verwaltung eines Abos ----------
  const sub = typeof view === "number" ? data.subscriptions.find((s) => s.id === view) : undefined;
  if (sub) {
    // Eine Zeile pro Konto (auch ohne Beteiligung), Aktive zuerst
    const rowsFor = directory.map((u) => {
      const ms = data.memberships.filter((m) => m.subscriptionId === sub.id && m.userId === u.id).sort((x, y) => x.validFromMonth.localeCompare(y.validFromMonth));
      const active = ms.some((m) => m.validFromMonth <= thisMonth && (m.validToMonth === null || m.validToMonth >= thisMonth));
      const future = ms.find((m) => m.validFromMonth > thisMonth);
      const status = active ? { rank: 0, label: "Aktiv", cls: "chip--confirmed" }
        : future ? { rank: 1, label: `Ab ${future.validFromMonth}`, cls: "chip--marked_paid" }
        : ms.length > 0 ? { rank: 2, label: "Beendet", cls: "chip--open" }
        : { rank: 3, label: "Nicht beteiligt", cls: "chip--none" };
      return { u, ms, status };
    }).sort((x, y) => x.status.rank - y.status.rank || x.u.displayName.localeCompare(y.u.displayName, "de"));
    const q = filter.trim().toLowerCase();
    const shown = rowsFor.filter((r) => !q || r.u.displayName.toLowerCase().includes(q) || r.u.username.includes(q));
    const now = priceNow(sub.id);
    const personIsActive = data.memberships.some((m) => m.subscriptionId === sub.id && String(m.userId) === person && m.validFromMonth <= thisMonth && (m.validToMonth === null || m.validToMonth >= thisMonth));
    const fromDefault = personIsActive ? nextMonth : newStart;
    return (
      <section className="section" style={{ borderTop: 0 }}>
        <button className="btn btn--small" onClick={() => { setView(null); onRefresh(); }}>‹ Alle Abos</button>
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, margin: "20px 0 4px", flexWrap: "wrap" }}>
          <h2 style={{ margin: 0, fontSize: 26 }}>{sub.name}{sub.archivedAt && <span className="chip chip--open" style={{ marginLeft: 12, verticalAlign: "middle" }}>Beendet</span>}</h2>
          <span className="mono">{now === null ? "kein Preis" : formatEuro(now)} <span className="muted">/ Monat</span></span>
        </header>

        <div style={{ marginTop: 16 }}>{infoNote}</div>
        {sub.archivedAt && (
          <div className="notice" style={{ marginTop: 16 }}>
            <p style={{ margin: "0 0 10px" }}>Dieses Abo ist beendet. Vergangene Monate bleiben unverändert. Zum Ändern zuerst wieder aktivieren.</p>
            <button className="btn btn--small" onClick={() => void onSubmit(() => api(`/api/manage/subscriptions/${sub.id}/reactivate`, "POST"), "Abo wieder aktiviert.")}>Wieder aktivieren</button>
          </div>
        )}

        <div className="section">
          <h3 className="h">Preis</h3>
          <div className="rows" style={{ margin: "12px 0 18px" }}>
            {pricesOf(sub.id).map((p) => (
              <div key={p.validFromMonth} className="row" style={{ gridTemplateColumns: "1fr auto" }}>
                <span className="mono muted">ab {p.validFromMonth}</span><span className="mono">{formatEuro(p.amountCents)}</span>
              </div>
            ))}
          </div>
          {!sub.archivedAt && <form className="grid2 grid2--stack" style={{ alignItems: "end" }} onSubmit={submit(
            async (f) => api(`/api/manage/subscriptions/${sub.id}/prices`, "POST", { validFromMonth: f.get("from"), priceCents: euro(f.get("price")) }), "Preis gespeichert.")}>
            <label className="f"><span className="label">Neuer Preis (EUR)</span><input name="price" inputMode="decimal" required placeholder="14,99" /></label>
            {monthField("from", nextMonth, "Gültig ab (Monat)")}
            <button className="btn">Preis ändern</button>
          </form>}
        </div>

        <div className="section">
          <h3 className="h">Teilnehmer</h3>
          {directory.length > 6 && <input aria-label="Konten filtern" placeholder="Name oder Benutzername suchen" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ margin: "12px 0 0" }} />}
          <div className="rows" style={{ margin: "12px 0 18px" }}>
            {shown.length === 0 && <p className="muted">Kein Konto gefunden.</p>}
            {shown.map(({ u, ms, status }) => (
              <button key={u.id} type="button" className="listbtn" aria-pressed={person === String(u.id)}
                onClick={() => { setPerson(String(u.id)); setWeight(String(ms[ms.length - 1]?.weight ?? 1)); }}>
                <span style={{ fontWeight: 600 }}>{u.displayName}{u.id === selfId && <span className="muted"> (du)</span>} <span className="mono muted" style={{ fontWeight: 400, fontSize: 12 }}>@{u.username}</span></span>
                <span className="mono muted">{ms.length === 0 ? "–" : ms.map((m) => `${m.weight}× ${m.validFromMonth} – ${m.validToMonth ?? "offen"}`).join(" · ")}</span>
                <span className={`chip ${status.cls}`}>{status.label}</span>
              </button>
            ))}
          </div>
          {directory.length > 0 && !sub.archivedAt && (
            <div className="grid2 grid2--stack" style={{ gap: 28 }}>
              <form className="stack" onSubmit={submit(
                async (f) => api("/api/manage/memberships", "PUT", { subscriptionId: sub.id, userId: Number(person), weight: Number(weight), from: f.get("from") }), "Beteiligung gespeichert.")}>
                <h4 className="h">Beteiligung setzen / Gewicht ändern</h4>
                <label className="f"><span className="label">Konto</span>
                  <select value={person} onChange={(e) => setPerson(e.target.value)} required>
                    <option value="" disabled>Bitte wählen</option>
                    {directory.map((u) => <option key={u.id} value={u.id}>{u.displayName} (@{u.username})</option>)}
                  </select></label>
                <label className="f"><span className="label">Gewicht (1 = gleicher Anteil)</span>
                  <input type="number" min={1} max={1000} value={weight} onChange={(e) => setWeight(e.target.value)} required /></label>
                {monthField("from", fromDefault, "Ab Monat")}
                <button className="btn btn--primary">Speichern</button>
              </form>
              <form className="stack" onSubmit={submit(
                async (f) => api("/api/manage/memberships/end", "POST", { subscriptionId: sub.id, userId: Number(person), lastMonth: f.get("last") }), "Beteiligung beendet.")}>
                <h4 className="h">Beteiligung beenden</h4>
                <p className="muted" style={{ margin: 0, fontSize: 14 }}>Gilt für das links gewählte Konto. Du kannst auch eine Zeile oben anklicken.</p>
                {monthField("last", thisMonth, "Letzter Monat der Beteiligung")}
                <button className="btn" disabled={!person}>Beenden</button>
              </form>
            </div>
          )}
        </div>

        {!sub.archivedAt && (
          <div className="section">
            <h3 className="h">Abo beenden</h3>
            <p className="muted" style={{ fontSize: 14 }}>Alle Beteiligungen enden nach dem gewählten Monat, das Abo wandert ins Archiv. Vergangene Monate bleiben unverändert. Das ist der normale Weg, wenn ein Abo gekündigt wird.</p>
            <form className="stack" style={{ maxWidth: 420 }} onSubmit={submit(
              async (f) => api(`/api/manage/subscriptions/${sub.id}/end`, "POST", { lastMonth: f.get("last") }), "Abo beendet.", () => setView(null))}>
              {monthField("last", thisMonth, "Letzter Monat des Abos")}
              <button className="btn">Abo beenden</button>
            </form>
          </div>
        )}

        <div className="section">
          <h3 className="h accent">Abo löschen</h3>
          <p className="muted" style={{ fontSize: 14 }}>Entfernt das Abo mit Preisen und Beteiligungen endgültig. Nur möglich, solange für das Abo noch keine Zahlungen angelegt wurden, sonst bitte beenden.</p>
          <button className="btn" style={{ borderColor: "var(--accent-text)", color: "var(--accent-text)" }} onClick={() => {
            if (window.confirm(`„${sub.name}“ wirklich endgültig löschen?`)) void onSubmit(() => api(`/api/manage/subscriptions/${sub.id}`, "DELETE"), "Abo gelöscht.").then((ok) => { if (ok) setView(null); });
          }}>Abo löschen</button>
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
      {data.subscriptions.length === 0 ? <p className="muted">Noch keine Abos angelegt.</p> : (
        <div className="rows">
          {data.subscriptions.filter((s) => showArchived || !s.archivedAt).map((s) => (
            <button key={s.id} type="button" className="listbtn listbtn--sub" onClick={() => { setView(s.id); setPerson(""); setWeight("1"); onRefresh(); }}>
              <span style={{ fontWeight: 700, fontSize: 18 }}>{s.name}{s.archivedAt && <span className="chip chip--open" style={{ marginLeft: 10 }}>Beendet</span>}</span>
              <span className="muted mono">{activeCount(s.id)} {activeCount(s.id) === 1 ? "Beteiligter" : "Beteiligte"}</span>
              <span className="mono">{priceNow(s.id) === null ? "–" : formatEuro(priceNow(s.id)!)}<span className="muted"> / Monat</span></span>
              <span aria-hidden="true" className="accent">›</span>
            </button>
          ))}
        </div>
      )}
      {data.subscriptions.some((s) => s.archivedAt) && (
        <button className="btn btn--small" style={{ marginTop: 18 }} onClick={() => setShowArchived(!showArchived)}>
          {showArchived ? "Beendete Abos ausblenden" : "Beendete Abos anzeigen"}
        </button>
      )}
    </section>
  );
}
