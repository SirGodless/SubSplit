import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openDatabase, runMigrations } from "@/db/client";
import { memberships, payments, subscriptions, users } from "@/db/schema";

const KEY = "k".repeat(40);

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "rm-"));
  const path = join(dir, "t.db");
  const h = openDatabase(path, KEY);
  runMigrations(h, "./drizzle");
  const linked = h.db.insert(users).values({ sub: "11111111-1111-4111-8111-111111111111" }).returning().get();
  const oldPayer = h.db.insert(users).values({ legacyUsername: "alt", legacyDisplayName: "Alt" }).returning().get();
  const oldOwner = h.db.insert(users).values({ legacyUsername: "chef", legacyDisplayName: "Chef" }).returning().get();
  return { dir, path, h, linked, oldPayer, oldOwner };
}
const run = (path: string, ...args: string[]) =>
  spawnSync("node", ["scripts/remove-unlinked-users.mjs", ...args], { env: { ...process.env, DATABASE_PATH: path, DB_ENCRYPTION_KEY: KEY }, encoding: "utf8" });

describe("scripts/remove-unlinked-users.mjs", () => {
  it("ohne --yes wird nichts gelöscht", () => {
    const { path, h } = setup();
    h.sqlite.close();
    const r = run(path);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("alt (Alt)");
    expect(r.stdout).toContain("Nichts gelöscht");
    const h2 = openDatabase(path, KEY);
    expect(h2.db.select().from(users).all()).toHaveLength(3);
    h2.sqlite.close();
  });
  it("löscht nur unverknüpfte Konten samt Beteiligungen und Zahlungen, legt vorher ein Backup an", () => {
    const { dir, path, h, linked, oldPayer, oldOwner } = setup();
    // Abo des verknüpften Kontos mit altem Mitzahler; das Konto "chef" besitzt nichts
    const sub = h.db.insert(subscriptions).values({ ownerUserId: linked.id, name: "Netflix" }).returning().get();
    h.db.insert(memberships).values({ subscriptionId: sub.id, userId: oldPayer.id, weight: 1, validFromMonth: "2026-11" }).run();
    h.db.insert(payments).values({ payerUserId: oldPayer.id, recipientUserId: linked.id, month: "2026-11", referenceId: "K7M2QX", amountCents: 1000 }).run();
    void oldOwner;
    h.sqlite.close();
    const r = run(path, "--yes");
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain("2 Konto/Konten gelöscht");
    expect(readdirSync(join(dir, "backups")).some((f) => f.startsWith("vor-entfernen-"))).toBe(true);
    const h2 = openDatabase(path, KEY);
    expect(h2.db.select().from(users).all().map((u) => u.sub)).toEqual(["11111111-1111-4111-8111-111111111111"]);
    expect(h2.db.select().from(subscriptions).all()).toHaveLength(1); // das Abo des verknüpften Kontos bleibt
    expect(h2.db.select().from(memberships).all()).toHaveLength(0);
    expect(h2.db.select().from(payments).all()).toHaveLength(0);
    h2.sqlite.close();
  });
  it("bricht ab, wenn ein unverknüpftes Konto noch ein Abo besitzt, und ändert nichts", () => {
    const { path, h, oldOwner } = setup();
    h.db.insert(subscriptions).values({ ownerUserId: oldOwner.id, name: "Spotify" }).run();
    h.sqlite.close();
    const r = run(path, "--yes");
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("besitzt noch Abos");
    const h2 = openDatabase(path, KEY);
    expect(h2.db.select().from(users).all()).toHaveLength(3);
    h2.sqlite.close();
  });
  it("sagt es, wenn es nichts zu tun gibt", () => {
    const dir = mkdtempSync(join(tmpdir(), "rm-"));
    const path = join(dir, "t.db");
    const h = openDatabase(path, KEY);
    runMigrations(h, "./drizzle");
    h.db.insert(users).values({ sub: "11111111-1111-4111-8111-111111111111" }).run();
    h.sqlite.close();
    expect(run(path, "--yes").stdout).toContain("keine unverknüpften Konten");
  });
});
