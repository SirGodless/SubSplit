import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { openDatabase, runMigrations, type Db } from "@/db/client";
import { memberships, payments } from "@/db/schema";
import { createSubscription, endSubscription, includeNewMembersInCurrentMonth, setMembership, setPrice } from "@/lib/services/manage";
import { ensureOwnerPayments, setPaidByPayer, setStatusByOwner } from "@/lib/services/payments";
import { createUser, updateRecipient } from "@/lib/services/users";

const NOW = new Date("2026-11-04T12:00:00Z");
const M = "2026-11";
const DEC = "2026-12";
let db: Db;
let boss: number, anna: number, bob: number, cleo: number, netflix: number;

const mk = (name: string, recipient = false) => {
  const id = createUser(db, { username: name, displayName: name[0]!.toUpperCase() + name.slice(1) });
  if (recipient) updateRecipient(db, id, { iban: "GB82 WEST 1234 5698 7654 32" });
  return id;
};
const pay = (payer: number, month = M) => db.select().from(payments).all().find((p) => p.payerUserId === payer && p.recipientUserId === boss && p.month === month);

beforeEach(() => {
  const h = openDatabase(":memory:");
  runMigrations(h, "./drizzle");
  db = h.db;
  boss = mk("boss", true);
  anna = mk("anna"); bob = mk("bob"); cleo = mk("cleo");
  netflix = createSubscription(db, boss, { name: "Netflix", priceCents: 1800, validFromMonth: M }, NOW);
  setMembership(db, boss, { subscriptionId: netflix, userId: anna, weight: 1, from: M }, NOW);
  setMembership(db, boss, { subscriptionId: netflix, userId: bob, weight: 1, from: M }, NOW);
  ensureOwnerPayments(db, boss, NOW);
});

describe("Neue Mitzahler in den laufenden Monat einrechnen", () => {
  it("ohne Knopf startet ein neuer Mitzahler erst im Folgemonat, mit Knopf sofort", () => {
    expect(() => setMembership(db, boss, { subscriptionId: netflix, userId: cleo, weight: 1, from: M }, NOW)).toThrow();
    setMembership(db, boss, { subscriptionId: netflix, userId: cleo, weight: 1, from: DEC }, NOW);
    expect(pay(cleo)).toBeUndefined();
    const r = includeNewMembersInCurrentMonth(db, boss, NOW);
    expect(r).toEqual({ members: 1, adjusted: 2, created: 1 });
    expect(pay(cleo)?.amountCents).toBe(600);
    expect(pay(anna)?.amountCents).toBe(600);
    expect(pay(bob)?.amountCents).toBe(600);
  });

  it("bezahlte und bestätigte Beträge der anderen bleiben unverändert, offene werden gesenkt", () => {
    setPaidByPayer(db, anna, boss, true, NOW);
    setStatusByOwner(db, boss, pay(bob)!.id, "confirmed", NOW);
    setMembership(db, boss, { subscriptionId: netflix, userId: cleo, weight: 1, from: DEC }, NOW);
    const r = includeNewMembersInCurrentMonth(db, boss, NOW);
    expect(r).toEqual({ members: 1, adjusted: 0, created: 1 });
    expect(pay(anna)?.amountCents).toBe(900);
    expect(pay(anna)?.status).toBe("marked_paid");
    expect(pay(bob)?.amountCents).toBe(900);
    expect(pay(bob)?.status).toBe("confirmed");
    expect(pay(cleo)?.amountCents).toBe(600);
  });

  it("zweimal ausgeführt ändert nichts mehr, und der Folgemonat stimmt", () => {
    setMembership(db, boss, { subscriptionId: netflix, userId: cleo, weight: 1, from: DEC }, NOW);
    includeNewMembersInCurrentMonth(db, boss, NOW);
    expect(includeNewMembersInCurrentMonth(db, boss, NOW)).toEqual({ members: 0, adjusted: 0, created: 0 });
    const rows = db.select().from(memberships).where(and(eq(memberships.userId, cleo))).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.validFromMonth).toBe(M);
  });

  it("Gewichtsänderungen bestehender Mitzahler werden nicht vorgezogen", () => {
    setMembership(db, boss, { subscriptionId: netflix, userId: anna, weight: 2, from: DEC }, NOW);
    expect(includeNewMembersInCurrentMonth(db, boss, NOW)).toEqual({ members: 0, adjusted: 0, created: 0 });
    expect(pay(anna)?.amountCents).toBe(900);
    expect(db.select().from(memberships).where(eq(memberships.userId, anna)).all().some((m) => m.validFromMonth === DEC && m.weight === 2)).toBe(true);
  });

  it("Beendete Abos und Abos ohne Preis für den laufenden Monat werden nicht angefasst", () => {
    const later = createSubscription(db, boss, { name: "Spotify", priceCents: 1000, validFromMonth: DEC }, NOW);
    setMembership(db, boss, { subscriptionId: later, userId: cleo, weight: 1, from: DEC }, NOW);
    expect(includeNewMembersInCurrentMonth(db, boss, NOW).members).toBe(0);
    expect(db.select().from(memberships).where(eq(memberships.subscriptionId, later)).get()?.validFromMonth).toBe(DEC);
    setMembership(db, boss, { subscriptionId: netflix, userId: cleo, weight: 1, from: DEC }, NOW);
    endSubscription(db, boss, netflix, M, NOW);
    expect(includeNewMembersInCurrentMonth(db, boss, NOW).members).toBe(0);
  });

  it("Preis ab Folgemonat bleibt außen vor", () => {
    setPrice(db, boss, netflix, DEC, 2400, NOW);
    setMembership(db, boss, { subscriptionId: netflix, userId: cleo, weight: 1, from: DEC }, NOW);
    includeNewMembersInCurrentMonth(db, boss, NOW);
    expect(pay(cleo)?.amountCents).toBe(600); // laufender Monat zu 18 € geteilt durch 3
  });
});
