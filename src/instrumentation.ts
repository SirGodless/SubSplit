/**
 * Läuft einmal beim Serverstart: Konfiguration prüfen (bei Fehler klarer Abbruch),
 * Migrationen ausführen und SIGTERM sauber behandeln. Die Logik liegt in
 * instrumentation-node.ts, damit der Edge-Bundler keine Node-APIs bemängelt.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startup } = await import("./instrumentation-node");
    await startup();
  }
}
