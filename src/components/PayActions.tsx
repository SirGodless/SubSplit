"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/client/api";

/** "Ich habe bezahlt" bzw. Zurücknehmen: gilt für alles Offene bei diesem Empfänger (laufender Monat plus Rückstand). */
export default function PayActions({ recipientId, marked }: { recipientId: number; marked: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(paid: boolean) {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/me/pay/${recipientId}/paid`, "POST", { paid });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unbekannter Fehler");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <button type="button" className="btn btn--block" disabled={busy} onClick={() => send(!marked)}>
        {marked ? "Meldung zurücknehmen" : "Ich habe bezahlt"}
      </button>
      {error && <p className="notice" role="alert">{error}</p>}
    </div>
  );
}
