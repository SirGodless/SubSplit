"use client";
import { useCallback, useEffect, useState } from "react";
import CopyButton from "@/components/CopyButton";
import { api } from "@/lib/client/api";
import { VOLUME_LABEL } from "@/lib/format";

interface Account { id: number; username: string; displayName: string; role: "operator" | "user"; status: "invited" | "active" | "disabled"; volumeClass: keyof typeof VOLUME_LABEL; warning: null | "threshold" | "jump" }

const STATUS = { invited: { label: "Eingeladen", cls: "chip--marked_paid" }, active: { label: "Aktiv", cls: "chip--confirmed" }, disabled: { label: "Gesperrt", cls: "chip--open" } } as const;
const WARNING = { threshold: "Hohe Monatssumme", jump: "Starker Anstieg" } as const;

export default function OperatorApp({ selfId }: { selfId: number }) {
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [link, setLink] = useState<{ name: string; link: string } | null>(null);

  const load = useCallback(async () => {
    try {
      setAccounts((await api<{ accounts: Account[] }>("/api/operator/accounts")).accounts);
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : "Unbekannter Fehler" });
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function run(fn: () => Promise<void>, ok?: string) {
    try {
      await fn();
      if (ok) setMsg({ kind: "ok", text: ok });
      await load();
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : "Unbekannter Fehler" });
    }
  }

  return (
    <>
      <h1 className="h" style={{ marginBottom: 6 }}>Konten</h1>
      <p className="muted" style={{ marginTop: 0, fontSize: 14 }}>Du siehst hier alle Konten, setzt Passwörter zurück und sperrst Konten. Beträge, Zahlungsdaten und Teilnehmer anderer siehst du nicht, nur eine grobe Größenklasse der Monatssumme und eine Warnung bei Ungewöhnlichem.</p>
      {msg && <p className={`notice${msg.kind === "ok" ? " notice--ok" : ""}`} role={msg.kind === "err" ? "alert" : "status"} style={{ marginBottom: 16 }}>{msg.text}</p>}
      {link && (
        <div className="notice notice--ok" style={{ marginBottom: 18 }}>
          <p className="label">Link für {link.name} · wird nur jetzt angezeigt, 7 Tage gültig; nach dem Öffnen legt die Person ein neues Passwort fest</p>
          <p className="mono" style={{ wordBreak: "break-all", margin: "8px 0" }}>{link.link}</p>
          <CopyButton value={link.link} label="Link kopieren" />
        </div>
      )}

      <div className="scroll-x">
        <table className="t">
          <thead><tr><th>Konto</th><th>Status</th><th>Monatssumme</th><th>Hinweis</th><th>Aktion</th></tr></thead>
          <tbody>
            {(accounts ?? []).map((a) => (
              <tr key={a.id}>
                <td><div style={{ fontWeight: 600 }}>{a.displayName}{a.role === "operator" && <span className="chip chip--open" style={{ marginLeft: 8 }}>Betreiber</span>}</div><div className="mono muted" style={{ fontSize: 12 }}>@{a.username}</div></td>
                <td><span className={`chip ${STATUS[a.status].cls}`}>{STATUS[a.status].label}</span></td>
                <td className="mono muted">{VOLUME_LABEL[a.volumeClass]}</td>
                <td>{a.warning ? <span className="chip chip--warn">{WARNING[a.warning]}</span> : <span className="muted">–</span>}</td>
                <td>
                  <div className="actions">
                    {a.status !== "disabled" && (
                      <button className="btn btn--small" onClick={() => run(async () => { const d = await api<{ link: string }>(`/api/operator/accounts/${a.id}/setup-link`, "POST"); setLink({ name: a.displayName, link: d.link }); })}>
                        {a.status === "invited" ? "Einladungslink" : "Passwort zurücksetzen"}
                      </button>
                    )}
                    {a.id !== selfId && (
                      <button className="btn btn--small" onClick={() => run(async () => { await api(`/api/operator/accounts/${a.id}/disabled`, "POST", { disabled: a.status !== "disabled" }); }, a.status === "disabled" ? "Konto entsperrt." : "Konto gesperrt.")}>
                        {a.status === "disabled" ? "Entsperren" : "Sperren"}
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="muted" style={{ fontSize: 14, marginTop: 24 }}>Neue Konten entstehen über <b>Einladungslinks</b>: Jedes Konto kann sie im Reiter „Einladungen“ erstellen, du auch. Hier setzt du nur Passwörter zurück und sperrst oder entsperrst Konten.</p>
    </>
  );
}
