"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: form.get("username"), password: form.get("password") }),
      });
      if (res.ok) {
        router.replace("/admin");
        router.refresh();
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
      <label className="f"><span className="label">Benutzername</span><input name="username" autoComplete="username" required /></label>
      <label className="f"><span className="label">Passwort</span><input name="password" type="password" autoComplete="current-password" required /></label>
      {error && <p className="notice" role="alert">{error}</p>}
      <button className="btn btn--primary btn--block" disabled={busy}>Anmelden</button>
    </form>
  );
}
