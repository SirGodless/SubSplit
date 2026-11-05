"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/client/api";
import { formatMonth } from "@/lib/format";

type Reason = "before_due" | "after_due" | "paid" | "locked";

const HINT: Record<Reason, string> = {
  before_due: "Der Fälligkeitstag ist noch nicht erreicht: Du zahlst den laufenden Monat nicht mehr.",
  after_due: "Der Fälligkeitstag ist schon vorbei: Der laufende Monat bleibt zu zahlen.",
  paid: "Für den laufenden Monat hast du schon bezahlt gemeldet: Er bleibt zu zahlen.",
  locked: "Für den laufenden Monat gibt es beim Empfänger schon bezahlte Zahlungen: Es gilt erst ab dem Folgemonat.",
};

export default function LeaveButton({ id, name, effectiveMonth, reason }: { id: number; name: string; effectiveMonth: string; reason: Reason }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function leave() {
    if (!window.confirm(`Vom Abo „${name}“ abmelden?\n\nDu zahlst ab ${formatMonth(effectiveMonth)} nicht mehr dafür.\n${HINT[reason]}\nOffene Rückstände aus Vormonaten bleiben bestehen.`)) return;
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
