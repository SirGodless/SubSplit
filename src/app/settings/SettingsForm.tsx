"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, setCsrf } from "@/lib/client/api";

interface Initial { username: string; displayName: string; email: string; recipientName: string; paypalMe: string; iban: string; dueDay: number }
type Msg = { kind: "ok" | "err"; text: string } | null;

export default function SettingsForm({ initial }: { initial: Initial }) {
  const router = useRouter();
  const [profileMsg, setProfileMsg] = useState<Msg>(null);
  const [pwMsg, setPwMsg] = useState<Msg>(null);

  async function saveProfile(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const s = (k: string) => String(f.get(k) ?? "").trim();
    try {
      await api("/api/me/profile", "PATCH", {
        displayName: s("displayName"), email: s("email") || null,
        recipientName: s("recipientName") || null, paypalMe: s("paypalMe") || null, iban: s("iban") || null, dueDay: Number(s("dueDay")),
      });
      setProfileMsg({ kind: "ok", text: "Gespeichert." });
      router.refresh();
    } catch (err) {
      setProfileMsg({ kind: "err", text: err instanceof Error ? err.message : "Unbekannter Fehler" });
    }
  }

  async function changePassword(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    if (f.get("next") !== f.get("repeat")) return setPwMsg({ kind: "err", text: "Die beiden neuen Passwörter sind nicht gleich." });
    try {
      const d = await api<{ csrfToken: string }>("/api/me/password", "POST", { current: f.get("current"), next: f.get("next") });
      setCsrf(d.csrfToken);
      form.reset();
      setPwMsg({ kind: "ok", text: "Passwort geändert. Andere Geräte sind abgemeldet." });
    } catch (err) {
      setPwMsg({ kind: "err", text: err instanceof Error ? err.message : "Unbekannter Fehler" });
    }
  }

  const note = (m: Msg) => m && <p className={`notice${m.kind === "ok" ? " notice--ok" : ""}`} role={m.kind === "err" ? "alert" : "status"}>{m.text}</p>;

  return (
    <div style={{ paddingTop: 22 }}>
      <form className="stack" onSubmit={saveProfile}>
        <h1 className="h">Profil</h1>
        <p className="muted" style={{ margin: 0, fontSize: 14 }}>Benutzername: <span className="mono" style={{ color: "var(--text)" }}>{initial.username}</span></p>
        <label className="f"><span className="label">Anzeigename (für Mitzahler im selben Abo sichtbar)</span><input name="displayName" defaultValue={initial.displayName} required maxLength={60} /></label>
        <label className="f"><span className="label">E-Mail (optional, nur für dich)</span><input name="email" type="email" autoComplete="email" defaultValue={initial.email} /></label>

        <div className="section" style={{ marginTop: 10 }}>
          <h2 className="h">Zahlungsdaten als Empfänger</h2>
          <p className="muted" style={{ fontSize: 14 }}>Nur nötig, wenn du selbst Abos anlegst und Geld von anderen bekommst. Du brauchst mindestens IBAN oder PayPal.Me, beides ist möglich. Mitzahler sehen diese Daten nur auf ihrer Zahlungsseite bei dir.</p>
          <div className="stack">
            <label className="f"><span className="label">Name des Empfängers (für den GiroCode, sonst dein Anzeigename)</span><input name="recipientName" defaultValue={initial.recipientName} maxLength={70} /></label>
            <label className="f"><span className="label">PayPal.Me-Name (nur der Name nach paypal.me/)</span><input name="paypalMe" defaultValue={initial.paypalMe} autoCapitalize="none" maxLength={60} /></label>
            <label className="f"><span className="label">IBAN</span><input name="iban" defaultValue={initial.iban} autoCapitalize="characters" autoComplete="off" /></label>
            <label className="f"><span className="label">Fälligkeitstag im Monat (1–28)</span><input name="dueDay" type="number" min={1} max={28} defaultValue={initial.dueDay} required /></label>
          </div>
        </div>
        {note(profileMsg)}
        <button className="btn btn--primary">Speichern</button>
      </form>

      <form className="stack section" onSubmit={changePassword} style={{ marginTop: 34 }}>
        <h2 className="h">Passwort ändern</h2>
        <label className="f"><span className="label">Aktuelles Passwort</span><input name="current" type="password" autoComplete="current-password" required /></label>
        <label className="f"><span className="label">Neues Passwort (mindestens 12 Zeichen)</span><input name="next" type="password" autoComplete="new-password" minLength={12} required /></label>
        <label className="f"><span className="label">Neues Passwort wiederholen</span><input name="repeat" type="password" autoComplete="new-password" minLength={12} required /></label>
        {note(pwMsg)}
        <button className="btn">Passwort ändern</button>
      </form>
    </div>
  );
}
