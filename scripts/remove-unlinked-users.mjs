#!/usr/bin/env node
// Löscht Konten aus der Zeit VOR dem Hub, die nicht mit einem Hub-Konto verknüpft sind (users.sub ist leer). Mit ihnen gehen
// ihre Beteiligungen, Zahlungen und Daueraufträge weg (ON DELETE CASCADE). Gehört einem solchen Konto ein Abo, bricht das Skript
// ab: Erst die Abrechnung zurücksetzen (reset-billing.mjs) oder das Konto mit link-user.mjs verknüpfen.
// Verknüpfte Konten (mit Hub-Kennung) werden nie angefasst. Vorher legt das Skript automatisch ein Backup an.
//
//   Ansehen:   docker compose run --rm --no-deps subsplit node scripts/remove-unlinked-users.mjs
//   Löschen:   docker compose run --rm --no-deps subsplit node scripts/remove-unlinked-users.mjs --yes
//   (App vorher stoppen: docker compose stop subsplit)
import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const source = process.env.DATABASE_PATH || "/data/subsplit.db";
const key = process.env.DB_ENCRYPTION_KEY;
if (!key) {
  console.error("DB_ENCRYPTION_KEY fehlt.");
  process.exit(2);
}
if (!existsSync(source)) {
  console.error(`Datenbank nicht gefunden: ${source}`);
  process.exit(1);
}
const db = new Database(source, { fileMustExist: true });
try {
  db.pragma(`key='${key.replace(/'/g, "''")}'`);
  db.prepare("SELECT count(*) FROM sqlite_master").get(); // Schlüssel prüfen
  db.pragma("foreign_keys = ON");

  const one = (sql, ...p) => db.prepare(sql).get(...p).c;
  const users = db.prepare("SELECT id, legacy_username AS name, legacy_display_name AS display FROM users WHERE sub IS NULL ORDER BY id").all();
  if (users.length === 0) {
    console.log("Es gibt keine unverknüpften Konten.");
    process.exit(0);
  }
  console.log("Unverknüpfte Konten:");
  let blocked = false;
  for (const u of users) {
    const subs = one("SELECT count(*) AS c FROM subscriptions WHERE owner_user_id = ?", u.id);
    const pays = one("SELECT count(*) AS c FROM payments WHERE payer_user_id = ? OR recipient_user_id = ?", u.id, u.id);
    const ms = one("SELECT count(*) AS c FROM memberships WHERE user_id = ?", u.id);
    console.log(` - ${u.name} (${u.display}): ${subs} Abo(s), ${ms} Beteiligung(en), ${pays} Zahlung(en)`);
    if (subs > 0) blocked = true;
  }
  if (blocked) {
    console.error("\nMindestens ein Konto besitzt noch Abos. Erst die Abrechnung zurücksetzen (scripts/reset-billing.mjs --yes) oder das Konto verknüpfen (scripts/link-user.mjs).");
    process.exit(1);
  }
  if (!process.argv.includes("--yes")) {
    console.log("\nNichts gelöscht. Zum Löschen (mit ihren Beteiligungen, Zahlungen, Daueraufträgen): --yes");
    process.exit(0);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backup = join(dirname(source), "backups", `vor-entfernen-${stamp}.db`);
  mkdirSync(dirname(backup), { recursive: true });
  db.exec(`VACUUM INTO '${backup.replace(/'/g, "''")}'`);
  console.log(`\nBackup geschrieben: ${backup}`);
  const removed = db.transaction(() => db.prepare("DELETE FROM users WHERE sub IS NULL").run().changes)();
  console.log(`${removed} Konto/Konten gelöscht.`);
} catch (err) {
  console.error("Fehlgeschlagen (nichts geändert):", err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  db.close();
}
