"use client";
import { useState } from "react";

export default function UnsubscribeButton({ token }: { token: string }) {
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  async function go() {
    setState("busy");
    try {
      const res = await fetch(`/api/unsubscribe/${token}`, { method: "POST" });
      setState(res.ok ? "done" : "error");
    } catch {
      setState("error");
    }
  }
  if (state === "done") return <p className="notice notice--ok" role="status">Erledigt. Du bekommst diese E-Mails nicht mehr.</p>;
  return (
    <div className="stack" style={{ marginTop: 20 }}>
      {state === "error" && <p className="notice" role="alert">Das hat nicht geklappt. Bitte schalte es in den Einstellungen ab.</p>}
      <button className="btn btn--primary btn--block" disabled={state === "busy"} onClick={go}>Keine E-Mails dieser Art mehr</button>
    </div>
  );
}
