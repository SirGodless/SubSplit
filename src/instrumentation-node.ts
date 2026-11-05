import http, { type IncomingMessage } from "node:http";

/** Nur Node-Runtime (wird aus instrumentation.ts geladen). */
export async function startup() {
  const { loadConfig, ConfigError } = await import("@/lib/config");
  const { initDatabase, closeDatabase } = await import("@/db/client");

  let config;
  try {
    config = loadConfig();
  } catch (err) {
    console.error(err instanceof ConfigError ? err.message : err);
    process.exit(1);
  }

  try {
    const handle = initDatabase(config.databasePath, config.migrationsDir, config.dbEncryptionKey);
    // Ersteinrichtung: gibt es einen Betreiber ohne Passwort, steht ein einmaliger Einrichtungslink im Log.
    const { ensureOperator, bootstrapSetupToken } = await import("@/lib/services/users");
    ensureOperator(handle.db);
    const boot = bootstrapSetupToken(handle.db);
    if (boot) {
      console.log(`Ersteinrichtung: Öffne ${config.baseUrl}/setup/${boot.token} (24 Stunden gültig) und lege das Passwort für das Konto "${boot.username}" fest.`);
    }
  } catch (err) {
    console.error("Datenbank-Initialisierung fehlgeschlagen:", err instanceof Error ? err.message : err);
    process.exit(1);
  }

  installPeerHook();

  // E-Mail-Versand (optional): nur aktiv, wenn SMTP_HOST gesetzt ist.
  if (config.mail) {
    const { createSmtpTransport } = await import("@/lib/mail/transport");
    const { startMailScheduler } = await import("@/lib/mail/scheduler");
    const { getDbHandle } = await import("@/db/client");
    const { safeError } = await import("@/lib/services/mail");
    const transport = createSmtpTransport(config.mail);
    const scheduler = startMailScheduler({
      db: getDbHandle().db,
      transport,
      ctx: { appName: config.appName, baseUrl: config.baseUrl, secret: config.sessionSecret, settings: config.reminders },
    });
    (globalThis as unknown as { __subsplitMailKick?: () => void }).__subsplitMailKick = scheduler.kick;
    transport.verify().then(
      () => console.log(`E-Mail-Versand aktiv (SMTP ${config.mail!.host}:${config.mail!.port}, ${config.mail!.security}), Absender ${config.mail!.fromAddress}.`),
      (err) => console.error(`E-Mail-Versand konfiguriert, aber der SMTP-Server ist nicht erreichbar: ${safeError(err)} (Versuche werden wiederholt, sobald er antwortet.)`),
    );
  } else {
    console.log("E-Mail-Versand ist aus (SMTP_HOST nicht gesetzt).");
  }

  const shutdown = (signal: string) => {
    console.log(`${signal} empfangen, fahre herunter.`);
    closeDatabase();
    process.exit(0);
  };
  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));
}

/**
 * Next.js reicht die Socket-Adresse nicht an Route-Handler durch. Daher wird bei jeder eingehenden
 * HTTP-Anfrage der Header x-subsplit-peer mit der echten Peer-Adresse gesetzt – ein vom Client
 * mitgeschickter Wert wird dabei immer überschrieben.
 */
function installPeerHook() {
  const marker = Symbol.for("subsplit.peerHook");
  const proto = http.Server.prototype as unknown as Record<symbol, boolean> & { emit: (...a: unknown[]) => boolean };
  if (proto[marker]) return;
  const original = proto.emit;
  proto.emit = function patched(this: unknown, event: unknown, ...args: unknown[]) {
    if (event === "request") {
      const req = args[0] as IncomingMessage;
      req.headers["x-subsplit-peer"] = req.socket.remoteAddress ?? "";
    }
    return original.call(this, event, ...args);
  };
  proto[marker] = true;
}
