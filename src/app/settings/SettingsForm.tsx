"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/client/api";

interface Initial {
  username: string; email: string; hubAccountUrl: string; recipientName: string; paypalMe: string; iban: string; dueDay: number;
  emailVerified: boolean; remindersEnabled: boolean; priceMailsEnabled: boolean; mailEnabled: boolean;
}
type Msg = { kind: "ok" | "err"; text: string } | null;

const note = (m: Msg) => m && <p className={`notice${m.kind === "ok" ? " notice--ok" : ""}`} role={m.kind === "err" ? "alert" : "status"}>{m.text}</p>;
const errText = (e: unknown) => (e instanceof Error ? e.message : "Unbekannter Fehler");

export default function SettingsForm({ initial }: { initial: Initial }) {
  const router = useRouter();
  const [profileMsg, setProfileMsg] = useState<Msg>(null);
  const [mailMsg, setMailMsg] = useState<Msg>(null);
  const [reminders, setReminders] = useState(initial.remindersEnabled);
  const [priceMails, setPriceMails] = useState(initial.priceMailsEnabled);

  async function saveProfile(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const s = (k: string) => String(f.get(k) ?? "").trim();
    try {
      await api("/api/me/profile", "PATCH", {
        recipientName: s("recipientName") || null, paypalMe: s("paypalMe") || null, iban: s("iban") || null, dueDay: Number(s("dueDay")),
      });
      setProfileMsg({ kind: "ok", text: "Gespeichert." });
      router.refresh();
    } catch (err) {
      setProfileMsg({ kind: "err", text: errText(err) });
    }
  }

  async function mailAction(path: string, okText: string) {
    setMailMsg(null);
    try {
      await api(path, "POST");
      setMailMsg({ kind: "ok", text: okText });
    } catch (err) {
      setMailMsg({ kind: "err", text: errText(err) });
    }
  }

  async function setPref(key: "remindersEnabled" | "priceMailsEnabled", value: boolean) {
    setMailMsg(null);
    try {
      await api("/api/me/notifications", "PATCH", { [key]: value });
      if (key === "remindersEnabled") setReminders(value);
      else setPriceMails(value);
    } catch (err) {
      setMailMsg({ kind: "err", text: errText(err) });
    }
  }

  return (
    <div style={{ paddingTop: 22 }}>
      <form className="stack" onSubmit={saveProfile}>
        <h1 className="h">Profil</h1>
        <p className="muted" style={{ margin: 0, fontSize: 14 }}>
          Benutzername und E-Mail-Adresse gehören zu deinem Konto im Hub und werden dort geändert.{" "}
          <a href={initial.hubAccountUrl}>Zum Konto im Hub</a>
        </p>
        <p style={{ margin: 0 }}>Benutzername (für Mitzahler sichtbar): <span className="mono">{initial.username}</span></p>

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

      <div className="section" style={{ marginTop: 34 }}>
        <h2 className="h">E-Mail-Benachrichtigungen</h2>
        {!initial.mailEnabled ? (
          <p className="muted" style={{ fontSize: 14 }}>Dieser Server verschickt keine E-Mails.</p>
        ) : !initial.email || !initial.emailVerified ? (
          <p className="muted" style={{ fontSize: 14 }}>Für Erinnerungen und Infos braucht dein Konto im Hub eine bestätigte E-Mail-Adresse. Die verwaltest du dort.</p>
        ) : (
          <div className="stack">
            <p style={{ margin: 0 }}><span className="chip chip--confirmed">Bestätigt</span></p>
            <label style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <input type="checkbox" checked={reminders} onChange={(e) => setPref("remindersEnabled", e.target.checked)} style={{ width: 20, minHeight: 20 }} />
              <span>Zahlungserinnerungen (wenn eine Zahlung nach dem Fälligkeitstag offen ist)</span>
            </label>
            <label style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <input type="checkbox" checked={priceMails} onChange={(e) => setPref("priceMailsEnabled", e.target.checked)} style={{ width: 20, minHeight: 20 }} />
              <span>Infos zu Preisänderungen</span>
            </label>
            <div><button type="button" className="btn btn--small" onClick={() => mailAction("/api/me/mail-test", "Test-Mail geschickt. Schau auch im Spam-Ordner nach.")}>Test-Mail senden</button></div>
          </div>
        )}
        {mailMsg && <div style={{ marginTop: 14 }}>{note(mailMsg)}</div>}
      </div>

    </div>
  );
}
