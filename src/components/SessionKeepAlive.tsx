"use client";
import { useEffect } from "react";

/**
 * Verlängert die Sitzung, solange jemand die Seite wirklich benutzt (Tippen, Klicken, Scrollen). Reine
 * Server-Seiten setzen kein Cookie; ohne diese Anfrage würde man trotz Aktivität nach dem Timeout abgemeldet.
 */
export default function SessionKeepAlive({ everySeconds = 300 }: { everySeconds?: number }) {
  useEffect(() => {
    let last = Date.now();
    const ping = () => {
      if (Date.now() - last < everySeconds * 1000) return;
      last = Date.now();
      fetch("/api/auth/session").then((r) => {
        if (r.status === 401) window.location.href = "/login";
      }).catch(() => {});
    };
    const events = ["pointerdown", "keydown", "scroll", "touchstart"] as const;
    events.forEach((e) => window.addEventListener(e, ping, { passive: true }));
    return () => events.forEach((e) => window.removeEventListener(e, ping));
  }, [everySeconds]);
  return null;
}
