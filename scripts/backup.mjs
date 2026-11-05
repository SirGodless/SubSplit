#!/usr/bin/env node
// Konsistentes Online-Backup der (verschlüsselten) SQLite-Datenbank, auch während die App läuft (WAL-sicher).
//   docker compose exec subsplit node scripts/backup.mjs /data/backups/subsplit-$(date +%F).db
// Das Backup ist mit demselben DB_ENCRYPTION_KEY verschlüsselt und ohne ihn nicht lesbar.
// Reines Kopieren der .db-Datei bei laufender App kann inkonsistent sein (WAL) - dieses Skript nicht.
import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const source = process.env.DATABASE_PATH || "/data/subsplit.db";
const key = process.env.DB_ENCRYPTION_KEY;
const target = process.argv[2];
if (!target) {
  console.error("Aufruf: node scripts/backup.mjs <Zieldatei>");
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
if (existsSync(target)) {
  console.error(`Ziel existiert bereits: ${target}`);
  process.exit(1);
}
mkdirSync(dirname(target), { recursive: true });
const db = new Database(source, { fileMustExist: true });
try {
  db.pragma(`key='${key.replace(/'/g, "''")}'`);
  db.prepare("SELECT count(*) FROM sqlite_master").get(); // Schlüssel prüfen
  db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  console.log(`Backup geschrieben: ${target}`);
} catch (err) {
  console.error("Backup fehlgeschlagen:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  db.close();
}
