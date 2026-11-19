#!/usr/bin/env node
// Verknüpft ein Konto aus der Zeit VOR dem Hub mit seinem Konto im Hub, damit Abos, Zahlungen und Empfängerdaten erhalten
// bleiben. Ohne Verknüpfung legt SubSplit beim ersten Login ein neues, leeres Konto an und das alte bleibt ungenutzt liegen.
//
//   Offene Konten anzeigen:  docker compose run --rm --no-deps subsplit node scripts/link-user.mjs --list
//   Verknüpfen:              docker compose run --rm --no-deps subsplit node scripts/link-user.mjs <alter-benutzername> <UUID-im-Hub> --yes
//
// Die UUID steht im Hub im Dashboard (Benutzer, Konto öffnen). Vor der Änderung wird automatisch ein Backup neben die
// Datenbank gelegt. Die App sollte dabei gestoppt sein (docker compose stop subsplit).
import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const source = process.env.DATABASE_PATH || "/data/subsplit.db";
const key = process.env.DB_ENCRYPTION_KEY;
const args = process.argv.slice(2);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

  if (args.includes("--list")) {
    const rows = db.prepare("SELECT legacy_username AS name, legacy_display_name AS display FROM users WHERE sub IS NULL ORDER BY legacy_username").all();
    console.log(rows.length ? "Noch nicht verknüpft:" : "Alle Konten sind mit dem Hub verknüpft.");
    for (const r of rows) console.log(` - ${r.name} (${r.display})`);
    process.exit(0);
  }

  const [name, sub] = args.filter((a) => !a.startsWith("--"));
  if (!name || !sub || !args.includes("--yes")) {
    console.error("Aufruf: node scripts/link-user.mjs <alter-benutzername> <UUID-im-Hub> --yes   (oder --list)");
    process.exit(2);
  }
  if (!UUID.test(sub)) {
    console.error("Das ist keine UUID. Sie steht im Hub im Dashboard beim Konto.");
    process.exit(2);
  }
  const user = db.prepare("SELECT id FROM users WHERE legacy_username = ? AND sub IS NULL").get(name.toLowerCase());
  if (!user) {
    console.error(`Kein unverknüpftes Konto mit dem alten Benutzernamen "${name}". Mit --list ansehen.`);
    process.exit(1);
  }
  if (db.prepare("SELECT 1 FROM users WHERE sub = ?").get(sub.toLowerCase())) {
    console.error("Diese UUID ist schon einem Konto zugeordnet (vermutlich hat sich die Person schon angemeldet und hat ein neues, leeres Konto). Dieses neue Konto muss zuerst weg, sonst gäbe es zwei.");
    process.exit(1);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backup = join(dirname(source), "backups", `vor-link-${stamp}.db`);
  mkdirSync(dirname(backup), { recursive: true });
  db.exec(`VACUUM INTO '${backup.replace(/'/g, "''")}'`);
  console.log(`Backup geschrieben: ${backup}`);
  db.prepare("UPDATE users SET sub = ?, legacy_username = NULL, legacy_display_name = NULL WHERE id = ?").run(sub.toLowerCase(), user.id);
  console.log(`Konto "${name}" ist jetzt mit ${sub.toLowerCase()} verknüpft.`);
} finally {
  db.close();
}
