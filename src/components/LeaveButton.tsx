"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/client/api";
import { formatMonth } from "@/lib/format";

export default function LeaveButton({ id, name, effectiveMonth }: { id: number; name: string; effectiveMonth: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function leave() {
    if (!window.confirm(`Vom Abo „${name}“ abmelden?\n\nDu zahlst ab ${formatMonth(effectiveMonth)} nicht mehr dafür. Der laufende Monat bleibt zu zahlen, ebenso offene Rückstände aus Vormonaten.`)) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/api/me/subscriptions/${id}/leave`, "POST");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unbekannter Fehler");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button type="button" className="btn btn--small" disabled={busy} onClick={leave}>Abmelden</button>
      {error && <p className="notice" role="alert" style={{ marginTop: 8 }}>{error}</p>}
    </div>
  );
}
