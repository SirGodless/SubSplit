#!/usr/bin/env node
// Setzt die Abrechnung zurück: löscht Abos, Preise, Beteiligungen, Zahlungen, Daueraufträge und wartende
// Erinnerungs-/Preis-Mails. Konten (Benutzer, Passwörter, Zahlungsdaten, E-Mail), Einladungen und Bestätigungen bleiben.
// Vorher wird automatisch ein Backup neben die Datenbank gelegt.
//   App stoppen:   docker compose stop subsplit
//   Zurücksetzen:  docker compose run --rm --no-deps subsplit node scripts/reset-billing.mjs --yes
//   App starten:   docker compose up -d
import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const source = process.env.DATABASE_PATH || "/data/subsplit.db";
const key = process.env.DB_ENCRYPTION_KEY;
if (!process.argv.includes("--yes")) {
  console.error("Das löscht ALLE Abos, Beteiligungen, Preise, Zahlungen und Daueraufträge (Konten bleiben).\nZum Ausführen: node scripts/reset-billing.mjs --yes");
  process.exit(2);
}
if (!key) {
  console.error("DB_ENCRYPTION_KEY fehlt.");
  process.exit(2);
}
if (!existsSync(source)) {
  console.error(`Datenbank nicht gefunden: ${source}`);
  process.exit(1);
}
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const backup = join(dirname(source), "backups", `vor-reset-${stamp}.db`);
mkdirSync(dirname(backup), { recursive: true });
const db = new Database(source, { fileMustExist: true });
try {
  db.pragma(`key='${key.replace(/'/g, "''")}'`);
  db.prepare("SELECT count(*) FROM sqlite_master").get(); // Schlüssel prüfen
  db.exec(`VACUUM INTO '${backup.replace(/'/g, "''")}'`);
  console.log(`Backup geschrieben: ${backup}`);
  db.pragma("foreign_keys = ON");
  const counts = {};
  db.transaction(() => {
    // Reihenfolge: erst abhängige Tabellen
    for (const t of ["payments", "standing_orders", "memberships", "subscription_prices", "subscriptions", "reminder_log"]) {
      counts[t] = db.prepare(`DELETE FROM ${t}`).run().changes;
    }
    counts.mail_outbox = db.prepare("DELETE FROM mail_outbox WHERE type IN ('reminder','price_change') AND status <> 'sent'").run().changes;
    db.prepare("DELETE FROM sqlite_sequence WHERE name IN ('payments','standing_orders','memberships','subscription_prices','subscriptions','reminder_log')").run();
  })();
  console.log("Gelöscht:", counts);
  console.log("Konten, Einladungen und E-Mail-Bestätigungen sind unverändert.");
} catch (err) {
  console.error("Zurücksetzen fehlgeschlagen (nichts geändert):", err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  db.close();
}
