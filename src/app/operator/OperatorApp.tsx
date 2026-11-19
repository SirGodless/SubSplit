"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import { VOLUME_LABEL } from "@/lib/format";

interface Account { id: number; username: string; status: "active" | "no_access" | "banned" | "unknown"; volumeClass: keyof typeof VOLUME_LABEL; warning: null | "threshold" | "jump" }

const STATUS = {
  active: { label: "Aktiv", cls: "chip--confirmed" },
  no_access: { label: "Ohne Zugang", cls: "chip--marked_paid" },
  banned: { label: "Gesperrt", cls: "chip--open" },
  unknown: { label: "Unbekannt", cls: "chip--marked_paid" },
} as const;
const WARNING = { threshold: "Hohe Monatssumme", jump: "Starker Anstieg" } as const;

/** Übersicht für den Betreiber. Konten, Passwörter, Sperren und Rechte verwaltet der Hub, hier gibt es nur die Größenklassen. */
export default function OperatorApp({ hubUrl }: { hubUrl: string }) {
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ accounts: Account[] }>("/api/operator/accounts").then((d) => setAccounts(d.accounts), (e) => setError(e instanceof Error ? e.message : "Unbekannter Fehler"));
  }, []);

  return (
    <>
      <h1 className="h" style={{ marginBottom: 6 }}>Konten</h1>
      <p className="muted" style={{ marginTop: 0, fontSize: 14 }}>
        Du siehst hier die Konten mit einer groben Größenklasse der Monatssumme und einer Warnung bei Ungewöhnlichem. Beträge, Zahlungsdaten und Teilnehmer anderer siehst du nicht.
        Konten, Einladungen, Passwörter, Sperren und Rechte verwaltest du im <a href={hubUrl}>Hub</a>.
      </p>
      {error && <p className="notice" role="alert" style={{ marginBottom: 16 }}>{error}</p>}
      <div className="scroll-x">
        <table className="t">
          <thead><tr><th>Konto</th><th>Status im Hub</th><th>Monatssumme</th><th>Hinweis</th></tr></thead>
          <tbody>
            {(accounts ?? []).map((a) => (
              <tr key={a.id}>
                <td style={{ fontWeight: 600 }}>{a.username}</td>
                <td><span className={`chip ${STATUS[a.status].cls}`}>{STATUS[a.status].label}</span></td>
                <td className="mono muted">{VOLUME_LABEL[a.volumeClass]}</td>
                <td>{a.warning ? <span className="chip chip--warn">{WARNING[a.warning]}</span> : <span className="muted">–</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
