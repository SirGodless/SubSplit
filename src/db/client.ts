import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { closeSync, existsSync, mkdirSync, openSync, readSync } from "node:fs";
import { dirname } from "node:path";
import * as schema from "./schema";

export type Db = BetterSQLite3Database<typeof schema>;
export type DbHandle = { db: Db; sqlite: Database.Database };

/**
 * Öffnet eine SQLite-Datei (oder ":memory:"). Mit `key` ist die GANZE Datei (inkl. WAL) verschlüsselt;
 * ohne Schlüssel ist sie im Klartext (nur für Tests gedacht).
 */
export function openDatabase(path: string, key?: string): DbHandle {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const sqlite = new Database(path);
  if (key) sqlite.pragma(`key='${key.replace(/'/g, "''")}'`); // muss die erste Anweisung sein
  try {
    sqlite.prepare("SELECT count(*) FROM sqlite_master").get();
  } catch {
    sqlite.close();
    throw new Error("Datenbank nicht lesbar: falscher DB_ENCRYPTION_KEY oder beschädigte Datei.");
  }
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  return { db: drizzle(sqlite, { schema }), sqlite };
}

export function runMigrations(handle: DbHandle, migrationsDir: string): void {
  migrate(handle.db, { migrationsFolder: migrationsDir });
}

/** True, wenn die Datei ein unverschlüsselter SQLite-Container ist (Klartext-Header). */
export function isPlainSqliteFile(path: string): boolean {
  if (!existsSync(path)) return false;
  const fd = openSync(path, "r");
  try {
    const buf = Buffer.alloc(16);
    const n = readSync(fd, buf, 0, 16, 0);
    return n === 16 && buf.toString("latin1") === "SQLite format 3\0";
  } finally {
    closeSync(fd);
  }
}

const g = globalThis as unknown as { __subsplitDb?: DbHandle };

/** Prozessweite Instanz; wird von instrumentation.ts initialisiert. */
export function getDbHandle(): DbHandle {
  if (!g.__subsplitDb) throw new Error("Datenbank nicht initialisiert");
  return g.__subsplitDb;
}

export function initDatabase(path: string, migrationsDir: string, key: string): DbHandle {
  if (g.__subsplitDb) return g.__subsplitDb;
  if (isPlainSqliteFile(path)) {
    throw new Error(
      `Die Datenbank ${path} ist unverschlüsselt (alte Version). Diese Version verschlüsselt die gesamte Datenbank und übernimmt alte Daten nicht. ` +
        "Bitte die alte Datenbank löschen (bei Docker: `docker compose down -v` leert das Volume) und neu starten.",
    );
  }
  const handle = openDatabase(path, key);
  runMigrations(handle, migrationsDir);
  g.__subsplitDb = handle;
  return handle;
}

export function closeDatabase(): void {
  if (!g.__subsplitDb) return;
  try {
    g.__subsplitDb.sqlite.close();
  } finally {
    g.__subsplitDb = undefined;
  }
}
