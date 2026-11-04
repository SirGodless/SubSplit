import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import * as schema from "./schema";

export type Db = BetterSQLite3Database<typeof schema>;
export type DbHandle = { db: Db; sqlite: Database.Database };

/** Öffnet eine SQLite-Datei (oder ":memory:") mit sinnvollen Pragmas. */
export function openDatabase(path: string): DbHandle {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const sqlite = new Database(path);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  return { db: drizzle(sqlite, { schema }), sqlite };
}

export function runMigrations(handle: DbHandle, migrationsDir: string): void {
  migrate(handle.db, { migrationsFolder: migrationsDir });
}

const g = globalThis as unknown as { __subsplitDb?: DbHandle };

/** Prozessweite Instanz; wird von instrumentation.ts initialisiert. */
export function getDbHandle(): DbHandle {
  if (!g.__subsplitDb) throw new Error("Datenbank nicht initialisiert");
  return g.__subsplitDb;
}

export function initDatabase(path: string, migrationsDir: string): DbHandle {
  if (g.__subsplitDb) return g.__subsplitDb;
  const handle = openDatabase(path);
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
