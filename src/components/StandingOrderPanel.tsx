"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/client/api";
import { formatMonth } from "@/lib/format";

/**
 * Dauerauftrag ein-/ausschalten (für den Zahler; der Empfänger hat denselben Schalter in der Übersicht).
 * Vertrauensbasis: Es wird nicht geprüft, ob der Dauerauftrag wirklich existiert.
 */
export default function StandingOrderPanel({ payerId, recipientId, active, thisMonth, nextMonth }: {
  payerId: number; recipientId: number; active: string | null; thisMonth: string; nextMonth: string;
}) {
  const router = useRouter();
  const [from, setFrom] = useState(thisMonth);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(fromMonth: string | null) {
    setBusy(true);
    setError(null);
    try {
      await api("/api/standing-orders", "POST", { payerUserId: payerId, recipientUserId: recipientId, fromMonth });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unbekannter Fehler");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <p className="label">Dauerauftrag</p>
      {active ? (
        <>
          <p style={{ margin: "8px 0 12px" }}>
            <span className="chip chip--confirmed">Aktiv</span>{" "}
            <span className="muted">ab {formatMonth(active)}: Die Zahlungen werden am Fälligkeitstag automatisch als bezahlt geführt.</span>
          </p>
          <button type="button" className="btn btn--small" disabled={busy} onClick={() => send(null)}>Dauerauftrag ausschalten</button>
        </>
      ) : (
        <>
          <p className="muted" style={{ margin: "8px 0 12px", fontSize: 14 }}>
            Hast du einen Dauerauftrag für diese Zahlungen eingerichtet? Dann wird jeder Monat ab dem gewählten Startmonat am Fälligkeitstag automatisch als bezahlt geführt. Rückstände aus früheren Monaten bleiben offen.
          </p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <select aria-label="Startmonat" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: "auto", minWidth: 170 }}>
              <option value={thisMonth}>ab {formatMonth(thisMonth)}</option>
              <option value={nextMonth}>ab {formatMonth(nextMonth)}</option>
            </select>
            <button type="button" className="btn btn--small btn--primary" disabled={busy} onClick={() => send(from)}>Dauerauftrag eingerichtet</button>
          </div>
        </>
      )}
      {error && <p className="notice" role="alert" style={{ marginTop: 12 }}>{error}</p>}
    </div>
  );
}
