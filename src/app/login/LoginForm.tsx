"use client";
import { useState } from "react";
import { setCsrf } from "@/lib/client/api";

export default function LoginForm({ next }: { next: string | null }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: form.get("username"), password: form.get("password") }),
      });
      if (res.ok) {
        setCsrf(((await res.json()) as { csrfToken: string }).csrfToken);
        window.location.href = next ?? "/";
        return;
      }
      setError(res.status === 429 ? "Zu viele Versuche. Bitte später erneut versuchen." : "Anmeldung fehlgeschlagen.");
    } catch {
      setError("Server nicht erreichbar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="stack">
      <label className="f"><span className="label">Benutzername</span><input name="username" autoComplete="username" autoCapitalize="none" required /></label>
      <label className="f"><span className="label">Passwort</span><input name="password" type="password" autoComplete="current-password" required /></label>
      {error && <p className="notice" role="alert">{error}</p>}
      <button className="btn btn--primary btn--block" disabled={busy}>Anmelden</button>
    </form>
  );
}
