"use client";
import { useState } from "react";
import { setCsrf } from "@/lib/client/api";

export default function SetupForm({ token }: { token: string }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const password = String(form.get("password") ?? "");
    if (password !== form.get("repeat")) return setError("Die beiden Passwörter sind nicht gleich.");
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/setup/${token}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password }) });
      const data = (await res.json().catch(() => ({}))) as { csrfToken?: string; message?: string };
      if (!res.ok) throw new Error(data.message ?? (res.status === 404 ? "Der Link ist ungültig oder abgelaufen." : "Das hat nicht geklappt."));
      setCsrf(data.csrfToken ?? null);
      window.location.href = "/";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unbekannter Fehler");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="stack" style={{ marginTop: 20 }}>
      <label className="f"><span className="label">Neues Passwort (mindestens 12 Zeichen)</span><input name="password" type="password" autoComplete="new-password" minLength={12} required /></label>
      <label className="f"><span className="label">Passwort wiederholen</span><input name="repeat" type="password" autoComplete="new-password" minLength={12} required /></label>
      {error && <p className="notice" role="alert">{error}</p>}
      <button className="btn btn--primary btn--block" disabled={busy}>Passwort festlegen und anmelden</button>
    </form>
  );
}
