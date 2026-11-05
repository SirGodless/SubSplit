import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openDatabase, runMigrations } from "@/db/client";
import { invitations, memberships, payments, subscriptionPrices, subscriptions, users } from "@/db/schema";

// Stand der ersten Mehrbenutzer-Version (nur Migration 0000). Schützt davor, dass eine neue Migration Daten vernichtet.
const V1 = "./tests/fixtures/drizzle-v1";
const KEY = "k".repeat(40);

describe("Upgrade einer bestehenden verschlüsselten Datenbank auf die aktuelle Migration", () => {
  it("alle Daten bleiben erhalten, neue Tabellen kommen dazu, ein zweiter Start ändert nichts", () => {
    const path = join(mkdtempSync(join(tmpdir(), "upg-")), "t.db");
    let h = openDatabase(path, KEY);
    runMigrations(h, V1);
    const [a, b] = h.db.insert(users).values([{ username: "anna", displayName: "Anna", passwordHash: "x" }, { username: "bob", displayName: "Bob", passwordHash: "y" }]).returning().all();
    const [s] = h.db.insert(subscriptions).values({ ownerUserId: a!.id, name: "Netflix" }).returning().all();
    h.db.insert(subscriptionPrices).values({ subscriptionId: s!.id, validFromMonth: "2026-11", amountCents: 1999 }).run();
    h.db.insert(memberships).values({ subscriptionId: s!.id, userId: b!.id, weight: 1, validFromMonth: "2026-11" }).run();
    h.db.insert(payments).values({ payerUserId: b!.id, recipientUserId: a!.id, month: "2026-11", referenceId: "K7M2QX", amountCents: 1000 }).run();
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

    runMigrations(h, "./drizzle");
    expect(h.db.select().from(users).all()).toHaveLength(2);
    h.sqlite.close();
  });
});
