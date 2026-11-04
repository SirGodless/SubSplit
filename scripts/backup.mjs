#!/usr/bin/env node
// Konsistentes Online-Backup der SQLite-Datenbank (auch während die App läuft, WAL-sicher).
//   docker compose exec subsplit node scripts/backup.mjs /data/backups/subsplit-$(date +%F).db
// Reines Kopieren der .db-Datei bei laufender App kann inkonsistent sein (WAL) – dieses Skript nicht.
import Database from "better-sqlite3";
import { mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";

const source = process.env.DATABASE_PATH || "/data/subsplit.db";
const target = process.argv[2];
if (!target) {
  console.error("Aufruf: node scripts/backup.mjs <Zieldatei>");
  process.exit(2);
}
if (!existsSync(source)) {
  console.error(`Datenbank nicht gefunden: ${source}`);
  process.exit(1);
}
mkdirSync(dirname(target), { recursive: true });
const db = new Database(source, { readonly: true, fileMustExist: true });
try {
  await db.backup(target);
  console.log(`Backup geschrieben: ${target}`);
} finally {
  db.close();
}
