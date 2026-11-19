import type { Db } from "@/db/client";
import type { HubApi } from "@/lib/hub/client";
import { refreshIdentities } from "@/lib/hub/identity";
import type { ReminderSettings } from "@/lib/config";
import type { MailCtx } from "@/lib/services/email";
import { processOutbox, purgeOldMail } from "@/lib/services/mail";
import { enqueueDueReminders } from "@/lib/services/reminders";
import type { MailTransport } from "./transport";

const TICK_MS = 15 * 60 * 1000;

/**
 * Planer im selben Prozess (kein Cron): alle 15 Minuten fällige Erinnerungen anlegen, Zahlungen/Daueraufträge
 * nachziehen und den Postausgang abarbeiten. Läuft nie doppelt gleichzeitig. Fehler werden ohne Details geloggt
 * (keine Adressen, keine Inhalte).
 */
export function startMailScheduler(opts: { db: Db; hub: HubApi; transport: MailTransport; ctx: MailCtx & { settings: ReminderSettings } }): { stop: () => void; kick: () => void } {
  let running = false;

  const run = async (full: boolean) => {
    if (running) return;
    running = true;
    try {
      await refreshIdentities(opts.db, opts.hub); // Adressen, Sperren und Zugang liegen beim Hub
      if (full) {
        enqueueDueReminders(opts.db, opts.ctx);
        purgeOldMail(opts.db);
      }
      await processOutbox(opts.db, opts.transport);
    } catch (err) {
      console.error("Mail-Planer: Fehler", err instanceof Error ? err.name : "unbekannt");
    } finally {
      running = false;
    }
  };

  const interval = setInterval(() => void run(true), TICK_MS);
  const first = setTimeout(() => void run(true), 30_000);
  interval.unref();
  first.unref();
  return {
    stop: () => {
      clearInterval(interval);
      clearTimeout(first);
    },
    /** Nach dem Anlegen einer Mail (Bestätigung, Test, Preisänderung): sofort versenden statt auf den nächsten Takt zu warten. */
    kick: () => void run(false),
  };
}
