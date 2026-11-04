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
    initDatabase(config.databasePath, config.migrationsDir);
  } catch (err) {
    console.error("Datenbank-Initialisierung fehlgeschlagen:", err instanceof Error ? err.message : err);
    process.exit(1);
  }

  const shutdown = (signal: string) => {
    console.log(`${signal} empfangen, fahre herunter.`);
    closeDatabase();
    process.exit(0);
  };
  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));
}
