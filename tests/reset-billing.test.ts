import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, runMigrations } from "@/db/client";
import { memberships, payments, subscriptions, users } from "@/db/schema";
import { createSubscription, setMembership } from "@/lib/services/manage";
import { ensureOwnerPayments } from "@/lib/services/payments";
import { createUser, updateRecipient } from "@/lib/services/users";

const KEY = "k".repeat(40);
let dir = "";
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ""; });

describe("scripts/reset-billing.mjs", () => {
  it("löscht Abrechnung, behält Konten, legt ein Backup an und verlangt --yes", () => {
    dir = mkdtempSync(join(tmpdir(), "reset-"));
    const path = join(dir, "t.db");
    const h = openDatabase(path, KEY);
    runMigrations(h, "./drizzle");
    const now = new Date("2026-11-04T12:00:00Z");
    const boss = createUser(h.db, { username: "boss", displayName: "Boss" });
    updateRecipient(h.db, boss, { iban: "GB82 WEST 1234 5698 7654 32" });
    const anna = createUser(h.db, { username: "anna", displayName: "Anna" });
    const sub = createSubscription(h.db, boss, { name: "Netflix", priceCents: 1800, validFromMonth: "2026-11" }, now);
    setMembership(h.db, boss, { subscriptionId: sub, userId: anna, weight: 1, from: "2026-11" }, now);
    ensureOwnerPayments(h.db, boss, now);
    expect(h.db.select().from(payments).all()).toHaveLength(1);
    h.sqlite.close();

    const env = { ...process.env, DATABASE_PATH: path, DB_ENCRYPTION_KEY: KEY };
    expect(() => execFileSync("node", ["scripts/reset-billing.mjs"], { env, stdio: "pipe" })).toThrow(); // ohne --yes
    execFileSync("node", ["scripts/reset-billing.mjs", "--yes"], { env, stdio: "pipe" });

    const h2 = openDatabase(path, KEY);
    expect(h2.db.select().from(payments).all()).toHaveLength(0);
    expect(h2.db.select().from(memberships).all()).toHaveLength(0);
    expect(h2.db.select().from(subscriptions).all()).toHaveLength(0);
    const u = h2.db.select().from(users).all();
    expect(u.map((x) => x.username).sort()).toEqual(["anna", "boss"]);
    expect(u.find((x) => x.username === "boss")?.iban).toBeTruthy();
    h2.sqlite.close();
    expect(readdirSync(join(dir, "backups")).some((f) => f.startsWith("vor-reset-"))).toBe(true);
  });
});
