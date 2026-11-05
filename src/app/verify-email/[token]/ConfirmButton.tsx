"use client";
import Link from "next/link";
import { useState } from "react";

export default function ConfirmButton({ token }: { token: string }) {
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  async function confirm() {
    setState("busy");
    try {
      const res = await fetch(`/api/verify-email/${token}`, { method: "POST" });
      setState(res.ok ? "done" : "error");
    } catch {
      setState("error");
    }
  }
  if (state === "done") return <p className="notice notice--ok" role="status">Die Adresse ist bestätigt. <Link href="/settings" style={{ textDecoration: "underline" }}>Zu den Einstellungen</Link></p>;
  return (
    <div className="stack" style={{ marginTop: 20 }}>
      {state === "error" && <p className="notice" role="alert">Das hat nicht geklappt. Der Link ist abgelaufen oder die Adresse wurde inzwischen geändert.</p>}
      <button className="btn btn--primary btn--block" disabled={state === "busy"} onClick={confirm}>Adresse bestätigen</button>
    </div>
  );
}
