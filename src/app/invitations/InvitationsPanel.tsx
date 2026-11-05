"use client";
import { useCallback, useEffect, useState } from "react";
import CopyButton from "@/components/CopyButton";
import { api } from "@/lib/client/api";
import { formatDate } from "@/lib/format";

interface Item { id: number; createdAt: string; expiresAt: string; state: "open" | "used" | "expired" | "revoked"; usedBy: string | null }
interface Data { max: number; canCreate: boolean; activeCount: number; items: Item[] }

const STATE = { open: { label: "Offen", cls: "chip--marked_paid" }, used: { label: "Eingelöst", cls: "chip--confirmed" }, expired: { label: "Abgelaufen", cls: "chip--none" }, revoked: { label: "Widerrufen", cls: "chip--none" } } as const;

export default function InvitationsPanel() {
  const [data, setData] = useState<Data | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api<Data>("/api/invitations"));
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : "Unbekannter Fehler" });
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function create() {
    setMsg(null);
    try {
      setLink((await api<{ link: string }>("/api/invitations", "POST")).link);
      await load();
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : "Unbekannter Fehler" });
    }
  }
  async function revoke(id: number) {
    try {
      await api(`/api/invitations/${id}`, "DELETE");
      setMsg({ kind: "ok", text: "Einladung widerrufen." });
      await load();
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : "Unbekannter Fehler" });
    }
  }

  const full = data ? data.activeCount >= data.max : false;
  if (data && !data.canCreate) {
    return (
      <div style={{ paddingTop: 22 }}>
        <h1 className="h" style={{ marginBottom: 6 }}>Einladungen</h1>
        <p className="notice">{data.max === 0 ? "Einladungen sind abgeschaltet." : "Einladungslinks kann nur der Betreiber erstellen."}</p>
      </div>
    );
  }
  return (
    <div style={{ paddingTop: 22 }}>
      <h1 className="h" style={{ marginBottom: 6 }}>Einladungen</h1>
      <p className="muted" style={{ marginTop: 0, fontSize: 14 }}>
        Mit einem Einladungslink kann sich eine Person selbst ein Konto erstellen (eigener Benutzername, Anzeigename und Passwort).
        Jeder Link ist einmalig und 7 Tage gültig. Du kannst höchstens {data?.max ?? 5} Links gleichzeitig offen haben.
      </p>
      {msg && <p className={`notice${msg.kind === "ok" ? " notice--ok" : ""}`} role={msg.kind === "err" ? "alert" : "status"} style={{ marginBottom: 16 }}>{msg.text}</p>}
      {link && (
        <div className="notice notice--ok" style={{ marginBottom: 18 }}>
          <p className="label">Neuer Einladungslink · wird nur jetzt angezeigt, 7 Tage gültig</p>
          <p className="mono" style={{ wordBreak: "break-all", margin: "8px 0" }}>{link}</p>
          <CopyButton value={link} label="Link kopieren" />
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", margin: "6px 0 18px" }}>
        <button className="btn btn--primary" onClick={create} disabled={full}>Einladungslink erstellen</button>
        {data && <span className="label">{data.activeCount} von {data.max} offen</span>}
      </div>
      {full && <p className="muted" style={{ fontSize: 14, marginTop: -6 }}>Das Limit ist erreicht. Ein Link wird frei, sobald er eingelöst wird, abläuft oder du ihn widerrufst.</p>}

      <h2 className="h" style={{ margin: "26px 0 10px" }}>Deine Einladungen</h2>
      {data && data.items.length === 0 ? <p className="muted">Noch keine Einladungen erstellt.</p> : (
        <div className="rows">
          {(data?.items ?? []).map((i) => (
            <div key={i.id} className="row" style={{ gridTemplateColumns: "1fr auto", alignItems: "center", padding: "12px 0" }}>
              <div>
                <span className={`chip ${STATE[i.state].cls}`}>{STATE[i.state].label}</span>
                <span className="muted" style={{ marginLeft: 12, fontSize: 14 }}>
                  {i.state === "used" ? `von ${i.usedBy ?? "?"}` : i.state === "open" ? `läuft ab am ${formatDate(i.expiresAt.slice(0, 10))}` : `erstellt am ${formatDate(i.createdAt.slice(0, 10))}`}
                </span>
              </div>
              {i.state === "open" && <button className="btn btn--small" onClick={() => revoke(i.id)}>Widerrufen</button>}
            </div>
          ))}
        </div>
      )}
      <p className="muted" style={{ fontSize: 13, marginTop: 28 }}>Den Link selbst kann die App nicht erneut anzeigen (gespeichert ist nur ein Hash). Ist er verloren, widerrufe ihn und erstelle einen neuen.</p>
    </div>
  );
}
