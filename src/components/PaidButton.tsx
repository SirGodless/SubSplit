"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function PaidButton({ token, month, marked }: { token: string; month: string; marked: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(paid: boolean) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/p/${token}/paid`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ month, paid }),
      });
      if (!res.ok) throw new Error(res.status === 409 ? "Diese Zahlung ist bereits bestätigt." : "Das hat nicht geklappt. Bitte später erneut versuchen.");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unbekannter Fehler");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      {marked ? (
        <button type="button" className="btn btn--block" disabled={busy} onClick={() => send(false)}>
          Meldung zurücknehmen
        </button>
      ) : (
        <button type="button" className="btn btn--block" disabled={busy} onClick={() => send(true)}>
          Ich habe bezahlt
        </button>
      )}
      {error && <p className="notice" role="alert">{error}</p>}
    </div>
  );
}
