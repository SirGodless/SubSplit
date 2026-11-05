import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openDatabase, runMigrations } from "@/db/client";
import { invitations, memberships, payments, standingOrders, subscriptionPrices, subscriptions, users } from "@/db/schema";

// Stand der ersten Mehrbenutzer-Version (nur Migration 0000). Schützt davor, dass eine neue Migration Daten vernichtet.
const V1 = "./tests/fixtures/drizzle-v1";
const KEY = "k".repeat(40);

describe("Upgrade einer bestehenden verschlüsselten Datenbank auf die aktuelle Migration", () => {
  it("alle Daten bleiben erhalten, neue Tabellen kommen dazu, ein zweiter Start ändert nichts", () => {
    const path = join(mkdtempSync(join(tmpdir(), "upg-")), "t.db");
    let h = openDatabase(path, KEY);
    runMigrations(h, V1);
    // Daten im alten Stand mit reinem SQL einfügen (das aktuelle Schema kennt Spalten, die es damals nicht gab)
    const q = h.sqlite;
    q.prepare("INSERT INTO users (id, username, display_name, password_hash) VALUES (1, 'anna', 'Anna', 'x'), (2, 'bob', 'Bob', 'y')").run();
    q.prepare("INSERT INTO subscriptions (id, owner_user_id, name) VALUES (1, 1, 'Netflix')").run();
    q.prepare("INSERT INTO subscription_prices (subscription_id, valid_from_month, amount_cents) VALUES (1, '2026-11', 1999)").run();
    q.prepare("INSERT INTO memberships (subscription_id, user_id, weight, valid_from_month) VALUES (1, 2, 1, '2026-11')").run();
    q.prepare("INSERT INTO payments (payer_user_id, recipient_user_id, month, reference_id, amount_cents) VALUES (2, 1, '2026-11', 'K7M2QX', 1000)").run();
    expect(() => h.db.select().from(invitations).all()).toThrow(/no such table/); // im alten Stand noch nicht da
    h.sqlite.close();

    h = openDatabase(path, KEY); // App-Start mit der aktuellen Migration
    runMigrations(h, "./drizzle");
    expect(h.db.select().from(users).all().map((u) => u.username).sort()).toEqual(["anna", "bob"]);
    expect(h.db.select().from(subscriptions).all()).toHaveLength(1);
    expect(h.db.select().from(subscriptionPrices).all()).toHaveLength(1);
    expect(h.db.select().from(memberships).all()).toHaveLength(1);
    expect(h.db.select().from(payments).all()[0]).toMatchObject({ referenceId: "K7M2QX", amountCents: 1000 });
    expect(h.db.select().from(invitations).all()).toEqual([]);
    expect(h.db.select().from(standingOrders).all()).toEqual([]);
    expect(h.db.select().from(payments).all()[0]).toMatchObject({ standingOrderState: null }); // neue Spalte, bestehende Zeilen unberührt

    runMigrations(h, "./drizzle");
    expect(h.db.select().from(users).all()).toHaveLength(2);
    h.sqlite.close();
  });
});
