import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { openDatabase, runMigrations, type Db } from "@/db/client";
import { memberships, payments, subscriptionPrices, subscriptions, users } from "@/db/schema";
import { AppError } from "@/lib/services/errors";
import {
  createSubscription, deleteSubscription, endMembership, endSubscription, reactivateSubscription, renameSubscription,
  setMembership, setPrice,
} from "@/lib/services/manage";
import { ensureMonthPayments, ensureOwnerPayments, firstStartMonthForNew, nextChangeMonth, setPaidByPayer, setStatusByOwner } from "@/lib/services/payments";
import { createUser, updateRecipient } from "@/lib/services/users";
import { getHome, getOperatorAccounts, getOwnerOverview, getPayerView, leaveSubscription, planLeave, volumeClassOf } from "@/lib/services/views";

const NOW = new Date("2026-11-04T12:00:00Z"); // 4. November 2026, Berlin
const M = "2026-11";
const IBAN = "GB82 WEST 1234 5698 7654 32";
let db: Db;
let boss: number, other: number, anna: number, bob: number, cleo: number;
let netflix: number, spotify: number;

function mk(name: string, opts: { iban?: boolean; dueDay?: number } = {}): number {
  const id = createUser(db, { username: name, displayName: name[0]!.toUpperCase() + name.slice(1), email: `${name}-geheim@example.org` });
  if (opts.iban || opts.dueDay) updateRecipient(db, id, { ...(opts.iban ? { iban: IBAN } : {}), ...(opts.dueDay ? { dueDay: opts.dueDay } : {}) });
  return id;
}
const payOf = (payer: number, recipient: number, month = M) => db.select().from(payments).all().find((p) => p.payerUserId === payer && p.recipientUserId === recipient && p.month === month);
const join = (owner: number, sub: number, user: number, weight = 1, from = M) => setMembership(db, owner, { subscriptionId: sub, userId: user, weight, from }, NOW);

beforeEach(() => {
  const h = openDatabase(":memory:");
  runMigrations(h, "./drizzle");
  db = h.db;
  boss = mk("boss", { iban: true });
  other = mk("other", { iban: true });
  anna = mk("anna"); bob = mk("bob"); cleo = mk("cleo");
  netflix = createSubscription(db, boss, { name: "Netflix", priceCents: 1800, validFromMonth: M }, NOW);
  spotify = createSubscription(db, boss, { name: "Spotify", priceCents: 900, validFromMonth: M }, NOW);
  join(boss, netflix, anna); join(boss, netflix, bob); join(boss, spotify, anna);
});

describe("Mandantentrennung: ein Konto kann nichts von einem anderen lesen oder ändern", () => {
  it("fremde Abos verhalten sich bei JEDER Verwaltungsfunktion wie nicht vorhanden", () => {
    const calls: Array<() => unknown> = [
      () => renameSubscription(db, other, netflix, "Gekapert"),
      () => setPrice(db, other, netflix, "2026-12", 1, NOW),
      () => setMembership(db, other, { subscriptionId: netflix, userId: cleo, weight: 1, from: "2026-12" }, NOW),
      () => endMembership(db, other, { subscriptionId: netflix, userId: anna, lastMonth: M }, NOW),
      () => endSubscription(db, other, netflix, M, NOW),
      () => reactivateSubscription(db, other, netflix),
      () => deleteSubscription(db, other, netflix),
    ];
    for (const c of calls) expect(c).toThrow(/Abo nicht gefunden/);
    // unverändert
    expect(db.select().from(subscriptions).where(eq(subscriptions.id, netflix)).get()).toMatchObject({ name: "Netflix", archivedAt: null, ownerUserId: boss });
    expect(db.select().from(memberships).where(eq(memberships.subscriptionId, netflix)).all()).toHaveLength(2);
    expect(db.select().from(subscriptionPrices).where(eq(subscriptionPrices.subscriptionId, netflix)).all()).toHaveLength(1);
  });
  it("fremde Zahlungen lassen sich nicht ändern, Übersicht und Ansicht zeigen nichts Fremdes", () => {
    ensureOwnerPayments(db, boss, NOW);
    const p = payOf(anna, boss)!;
    expect(setStatusByOwner(db, other, p.id, "confirmed", NOW)).toBe(false);
    expect(payOf(anna, boss)!.status).toBe("open");
    const ov = getOwnerOverview(db, other, M, NOW);
    expect(ov.payments).toEqual([]);
    expect(ov.totals.totalCostCents).toBe(0);
    expect(JSON.stringify(ov)).not.toMatch(/Anna|Bob|Netflix/);
    // Anna sieht beim fremden Empfänger nichts, weil sie dort keine Beziehung hat
    expect(getPayerView(db, anna, other, M, NOW)).toBeNull();
  });
  it("jemand ohne Beteiligung bei einem Empfänger kann dessen Zahlungsansicht nicht abrufen", () => {
    ensureOwnerPayments(db, boss, NOW);
    expect(getPayerView(db, cleo, boss, M, NOW)).toBeNull();
    expect(getPayerView(db, boss, boss, M, NOW)).toBeNull();
  });
  it("gesperrte Konten lassen sich nicht als Mitzahler eintragen", () => {
    db.update(users).set({ disabledAt: "2026-01-01" }).where(eq(users.id, cleo)).run();
    expect(() => join(boss, netflix, cleo, 1, "2026-12")).toThrow(/Konto nicht gefunden/);
  });
});

describe("Änderungsregeln: der laufende Monat ist fest", () => {
  const DEC = "2026-12";
  it("Hilfsfunktionen: Folgemonat, und neuer Start im laufenden Monat nur solange noch keine Zahlungen angelegt sind", () => {
    expect(nextChangeMonth(NOW)).toBe(DEC);
    expect(firstStartMonthForNew(db, boss, NOW)).toBe(M);
    ensureOwnerPayments(db, boss, NOW);
    expect(firstStartMonthForNew(db, boss, NOW)).toBe(DEC);
    expect(firstStartMonthForNew(db, other, NOW)).toBe(M); // anderer Empfänger unberührt
  });
  it("Bestehendes (Preis, Gewicht, Beenden) gilt immer erst ab dem Folgemonat, auch ohne angelegte Zahlungen", () => {
    expect(() => setPrice(db, boss, spotify, M, 1500, NOW)).toThrow(/ab dem Folgemonat \(2026-12\)/);
    expect(() => join(boss, netflix, anna, 3, M)).toThrow(/ab dem Folgemonat/); // Gewicht von Anna ändern
    expect(() => endMembership(db, boss, { subscriptionId: netflix, userId: bob, lastMonth: "2026-10" }, NOW)).toThrow(/ab dem Folgemonat/);
    expect(() => endSubscription(db, boss, spotify, "2026-10", NOW)).toThrow(/ab dem Folgemonat/);
    setPrice(db, boss, spotify, DEC, 1500, NOW);
    join(boss, netflix, anna, 3, DEC);
    endMembership(db, boss, { subscriptionId: netflix, userId: bob, lastMonth: M }, NOW); // wirkt ab Dezember
  });
  it("der laufende Monat bleibt bei allen Änderungen unverändert (keine Neuberechnung)", () => {
    ensureOwnerPayments(db, boss, NOW);
    const before = payOf(anna, boss)!;
    setPrice(db, boss, spotify, DEC, 5000, NOW);
    join(boss, netflix, cleo, 1, DEC);
    expect(payOf(anna, boss)).toMatchObject({ amountCents: before.amountCents, referenceId: before.referenceId });
    const dec = new Date("2026-12-02T10:00:00Z");
    ensureOwnerPayments(db, boss, dec);
    expect(payOf(anna, boss, DEC)!.amountCents).toBe(600 + 5000); // Netflix durch 3, Spotify jetzt 5000 (Anna allein)
  });
  it("neue Mitzahler und neue Abos dürfen im laufenden Monat starten, solange noch keine Zahlungen angelegt sind", () => {
    join(boss, netflix, cleo, 1, M); // Cleo ist neu in Netflix, Monat noch nicht abgerechnet
    expect(createSubscription(db, boss, { name: "Neu", priceCents: 300, validFromMonth: M }, NOW)).toBeGreaterThan(0);
    ensureOwnerPayments(db, boss, NOW);
    expect(payOf(cleo, boss)!.amountCents).toBe(600); // Netflix 1800 durch Anna, Bob und Cleo
  });
  it("sobald Zahlungen angelegt sind, starten Neue frühestens im Folgemonat", () => {
    ensureOwnerPayments(db, boss, NOW);
    expect(() => join(boss, netflix, cleo, 1, M)).toThrow(/frühestens ab 2026-12 \(für den laufenden Monat sind schon Zahlungen angelegt\)/);
    expect(() => createSubscription(db, boss, { name: "Neu", priceCents: 300, validFromMonth: M }, NOW)).toThrow(/frühestens ab 2026-12/);
    join(boss, netflix, cleo, 1, DEC);
    createSubscription(db, boss, { name: "Neu", priceCents: 300, validFromMonth: DEC }, NOW);
  });
  it("ein vergangener Startmonat ist nie erlaubt", () => {
    expect(() => join(boss, netflix, cleo, 1, "2026-10")).toThrow(/frühestens/);
    expect(() => createSubscription(db, boss, { name: "Alt", priceCents: 300, validFromMonth: "2026-10" }, NOW)).toThrow(/frühestens/);
  });
  it("der Empfänger kann selbst Mitglied sein (neu: im laufenden Monat, solange nichts angelegt ist); er schuldet sich nichts", () => {
    join(boss, netflix, boss);
    ensureOwnerPayments(db, boss, NOW);
    expect(payOf(anna, boss)!.amountCents).toBe(600 + 900);
    expect(payOf(bob, boss)!.amountCents).toBe(600);
    expect(db.select().from(payments).all().some((p) => p.payerUserId === boss)).toBe(false);
  });
  it("ohne IBAN und PayPal kann man kein Abo anlegen", () => {
    expect(() => createSubscription(db, anna, { name: "X", priceCents: 100, validFromMonth: M }, NOW)).toThrow(/IBAN oder PayPal/);
  });
});

describe("Abo beenden, wieder aktivieren, löschen", () => {
  const DEC = "2026-12";
  it("Beenden: Beteiligungen enden nach dem Monat, archiviert, Änderungen gesperrt, Vergangenheit und laufender Monat bleiben", () => {
    ensureOwnerPayments(db, boss, NOW);
    endSubscription(db, boss, spotify, M, NOW); // letzter Monat = aktueller Monat -> wirkt ab Dezember
    expect(db.select().from(subscriptions).where(eq(subscriptions.id, spotify)).get()!.archivedAt).not.toBeNull();
    expect(() => setPrice(db, boss, spotify, DEC, 100, NOW)).toThrow(/beendet/);
    expect(() => join(boss, spotify, bob, 1, DEC)).toThrow(/beendet/);
    const dec = new Date("2026-12-02T10:00:00Z");
    expect(getPayerView(db, anna, boss, M, dec)!.subscriptions.map((s) => s.name).sort()).toEqual(["Netflix", "Spotify"]);
    expect(getPayerView(db, anna, boss, DEC, dec)!.subscriptions.map((s) => s.name)).toEqual(["Netflix"]);
    reactivateSubscription(db, boss, spotify);
    join(boss, spotify, bob, 1, DEC);
  });
  it("Löschen: nur solange noch keine Zahlungen für das Abo angelegt wurden", () => {
    deleteSubscription(db, boss, spotify);
    expect(db.select().from(subscriptions).where(eq(subscriptions.id, spotify)).all()).toHaveLength(0);
    ensureOwnerPayments(db, boss, NOW);
    expect(() => deleteSubscription(db, boss, netflix)).toThrow(/stattdessen beenden/);
  });
});

describe("Rückstand: Vergessenes wird auf den nächsten Monat aufgeschlagen", () => {
  beforeEach(() => {
    // zweites Konto-Paar mit Start im Oktober, aber nie geöffnet
    const sub = db.insert(subscriptions).values({ ownerUserId: other, name: "Cloud" }).returning().get();
    db.insert(subscriptionPrices).values({ subscriptionId: sub.id, validFromMonth: "2026-09", amountCents: 1000 }).run();
    db.insert(memberships).values({ subscriptionId: sub.id, userId: cleo, weight: 1, validFromMonth: "2026-09" }).run();
    db.insert(memberships).values({ subscriptionId: sub.id, userId: bob, weight: 1, validFromMonth: "2026-09" }).run();
  });
  it("Monate, in denen niemand die App geöffnet hat, gehen nicht verloren", () => {
    ensureOwnerPayments(db, other, NOW);
    for (const m of ["2026-09", "2026-10", "2026-11"]) expect(payOf(cleo, other, m)!.amountCents, m).toBe(500);
  });
  it("Startseite und Zahlungsansicht: Gesamtbetrag = Rückstand + laufender Monat, Referenz der neuesten", () => {
    const home = getHome(db, cleo, NOW)!;
    expect(home.totalOutstandingCents).toBe(1500);
    expect(home.payments).toHaveLength(1);
    expect(home.payments[0]).toMatchObject({ recipientId: other, outstandingCents: 1500, arrearsCents: 1000 });
    const v = getPayerView(db, cleo, other, undefined, NOW)!;
    expect(v.outstanding.totalCents).toBe(1500);
    expect(v.outstanding.items.map((i) => i.month)).toEqual(["2026-09", "2026-10", "2026-11"]);
    expect(v.outstanding.hasArrears).toBe(true);
    expect(v.outstanding.referenceId).toBe(payOf(cleo, other, "2026-11")!.referenceId);
    expect(v.totalCents).toBe(500); // der laufende Monat allein
  });
  it("Bob schuldet bei zwei Empfängern getrennt, die Gesamtsumme der Startseite addiert beide", () => {
    ensureOwnerPayments(db, boss, NOW);
    const home = getHome(db, bob, NOW)!;
    expect(home.payments.map((p) => [p.recipientName, p.outstandingCents])).toEqual([["Boss", 900], ["Other", 1500]]);
    expect(home.totalOutstandingCents).toBe(2400);
  });
  it("'Ich habe bezahlt' deckt den Rückstand mit ab; Bestätigen der neuesten bestätigt auch die früheren", () => {
    getHome(db, cleo, NOW);
    expect(setPaidByPayer(db, cleo, other, true, NOW)).toBe("ok");
    expect(db.select().from(payments).all().filter((p) => p.payerUserId === cleo).every((p) => p.status === "marked_paid")).toBe(true);
    const home = getHome(db, cleo, NOW)!;
    expect(home.totalOutstandingCents).toBe(0);
    expect(home.totalReportedCents).toBe(1500);
    // zurücknehmen
    expect(setPaidByPayer(db, cleo, other, false, NOW)).toBe("ok");
    expect(getHome(db, cleo, NOW)!.totalOutstandingCents).toBe(1500);
    setPaidByPayer(db, cleo, other, true, NOW);
    expect(setStatusByOwner(db, other, payOf(cleo, other, "2026-11")!.id, "confirmed", NOW)).toBe(true);
    expect(db.select().from(payments).all().filter((p) => p.payerUserId === cleo).every((p) => p.status === "confirmed")).toBe(true);
    expect(setPaidByPayer(db, cleo, other, false, NOW)).toBe("locked"); // bestätigt = fest
  });
  it("die Übersicht des Empfängers zeigt den Rückstand pro Zahler", () => {
    const ov = getOwnerOverview(db, other, M, NOW);
    expect(ov.payments.map((p) => [p.payerName, p.amountCents, p.arrearsCents])).toEqual([["Bob", 500, 1000], ["Cleo", 500, 1000]]);
  });
});

describe("Austragen durch den Teilnehmer: gilt immer ab dem Folgemonat", () => {
  it("der laufende Monat bleibt zu zahlen und für die anderen unverändert, ab dem Folgemonat ist die Person nicht mehr dabei", () => {
    ensureOwnerPayments(db, boss, NOW);
    const annaBefore = payOf(anna, boss)!.amountCents;
    expect(planLeave(db, netflix, NOW)).toEqual({ effectiveMonth: "2026-12" });
    expect(leaveSubscription(db, bob, netflix, NOW)).toEqual({ effectiveMonth: "2026-12" });
    expect(payOf(bob, boss)!.amountCents).toBe(900); // November bleibt
    expect(payOf(anna, boss)!.amountCents).toBe(annaBefore); // Annas Betrag im laufenden Monat ändert sich nicht
    const dec = new Date("2026-12-02T10:00:00Z");
    expect(getPayerView(db, bob, boss, M, dec)!.subscriptions.map((s) => s.name)).toEqual(["Netflix"]);
    expect(getPayerView(db, bob, boss, "2026-12", dec)?.subscriptions ?? []).toEqual([]);
    expect(getPayerView(db, anna, boss, "2026-12", dec)!.subscriptions.find((s) => s.name === "Netflix")!.lines.map((l) => l.displayName)).toEqual(["Anna"]);
    expect(() => leaveSubscription(db, bob, netflix, NOW)).toThrow(/bereits ausgetragen/);
  });
  it("es spielt keine Rolle, ob der Fälligkeitstag schon vorbei ist oder ob schon bezahlt gemeldet wurde", () => {
    updateRecipient(db, boss, { dueDay: 10 }); // Fälligkeitstag noch nicht erreicht (heute ist der 4.)
    ensureOwnerPayments(db, boss, NOW);
    setPaidByPayer(db, bob, boss, true, NOW);
    expect(leaveSubscription(db, bob, netflix, NOW)).toEqual({ effectiveMonth: "2026-12" });
    expect(payOf(bob, boss)).toMatchObject({ status: "marked_paid", amountCents: 900 });
  });
  it("Rückstand aus Vormonaten bleibt nach dem Austragen bestehen", () => {
    const sub = db.insert(subscriptions).values({ ownerUserId: other, name: "Cloud" }).returning().get();
    db.insert(subscriptionPrices).values({ subscriptionId: sub.id, validFromMonth: "2026-10", amountCents: 1000 }).run();
    db.insert(memberships).values({ subscriptionId: sub.id, userId: cleo, weight: 1, validFromMonth: "2026-10" }).run();
    ensureOwnerPayments(db, other, NOW);
    leaveSubscription(db, cleo, sub.id, NOW);
    expect(getHome(db, cleo, NOW)!.totalOutstandingCents).toBe(2000); // Oktober + November
  });
  it("wer nicht beteiligt ist, kann nichts austragen", () => {
    expect(() => leaveSubscription(db, cleo, netflix, NOW)).toThrow(/nicht beteiligt/);
    expect(() => leaveSubscription(db, cleo, 9999, NOW)).toThrow(AppError);
  });
  it("die Startseite zeigt die eigenen Abos und, ab wann ein Austragen gilt", () => {
    const home = getHome(db, anna, NOW)!;
    expect(home.subscriptions.map((s) => [s.name, s.ownerName, s.leave?.effectiveMonth])).toEqual([["Netflix", "Boss", "2026-12"], ["Spotify", "Boss", "2026-12"]]);
  });
});

describe("Übersicht des Empfängers: Gesamtkosten, bezahlt und offen, Verlauf", () => {
  it("Gesamtkosten = Teilnehmer-Soll + eigener Anteil; bezahlt/offen/bestätigt summieren sich zum Soll", () => {
    join(boss, spotify, boss); // Admin ist selbst dabei
    ensureMonthPayments(db, boss, M, NOW);
    setPaidByPayer(db, anna, boss, true, NOW);
    setStatusByOwner(db, boss, payOf(bob, boss)!.id, "confirmed", NOW);
    const t = getOwnerOverview(db, boss, M, NOW).totals;
    expect(t.totalCostCents).toBe(2700);
    expect(t.dueCents + t.ownShareCents).toBe(t.totalCostCents);
    expect(t.confirmedCents + t.reportedCents + t.openCents).toBe(t.dueCents);
    expect(t.confirmedCents).toBe(900); // Bob
    expect(t.reportedCents).toBeGreaterThan(0); // Anna
    expect(t.openCents).toBe(0);
  });
  it("Verlauf enthält nur Monate ab dem ersten Abrechnungsmonat, höchstens 12", () => {
    const later = new Date("2027-03-02T10:00:00Z");
    const ov = getOwnerOverview(db, boss, undefined, later);
    expect(ov.history.map((h) => h.month)).toEqual(["2026-11", "2026-12", "2027-01", "2027-02", "2027-03"]);
    expect(ov.history.every((h) => h.totalCostCents === 2700)).toBe(true);
  });
  it("zukünftige Monate sind nicht abrufbar", () => {
    expect(() => getOwnerOverview(db, boss, "2026-12", NOW)).toThrow(/Zukünftige/);
  });
});

describe("Zahlungsansicht: Sichtbarkeit", () => {
  it("zeigt nur eigene Beträge, Mitzahler-Anzeigenamen im selben Abo und Zahlungsdaten des Empfängers", () => {
    const v = getPayerView(db, bob, boss, M, NOW)!;
    expect(v.subscriptions.map((s) => s.name)).toEqual(["Netflix"]); // Spotify gehört nicht zu Bobs Beteiligungen
    expect(v.subscriptions[0]!.lines.map((l) => [l.displayName, l.amountCents, l.isYou])).toEqual([["Anna", 900, false], ["Bob", 900, true]]);
    expect(v.recipientPay).toEqual({ name: "Boss", iban: "GB82WEST12345698765432", paypalMe: null });
    const json = JSON.stringify(v);
    for (const secret of ["geheim", "@example.org", "email", "passwordHash", "username"]) expect(json.toLowerCase()).not.toContain(secret.toLowerCase());
    expect(json).not.toContain(payOf(anna, boss)!.referenceId); // fremde Referenz-ID
    expect(Object.keys(v).sort()).toEqual(["dueDate", "expected", "month", "months", "outstanding", "payment", "recipient", "recipientPay", "reportedCents", "standingOrder", "subscriptions", "totalCents"]);
  });
});

describe("Betreiber-Sicht", () => {
  it("Größenklassen", () => {
    expect([0, 1, 9_999, 10_000, 29_999, 30_000, 99_999, 100_000].map(volumeClassOf)).toEqual(["none", "lt100", "lt100", "100to300", "100to300", "300to1000", "300to1000", "gt1000"]);
  });
  it("zeigt nur Konto-Stammdaten, Größenklasse und Warnung, keine Beträge, Daten oder Teilnehmer", () => {
    const list = getOperatorAccounts(db, { thresholdCents: 50_000, factor: 3 }, NOW);
    const b = list.find((a) => a.username === "boss")!;
    expect(b).toMatchObject({ role: "user", status: "invited", volumeClass: "lt100", warning: null });
    expect(Object.keys(b).sort()).toEqual(["displayName", "id", "role", "status", "username", "volumeClass", "warning"]);
    const json = JSON.stringify(list);
    // Anzeigenamen der Konten sind sichtbar, Abos, Beträge, Zahlungsdaten und E-Mails nicht
    for (const secret of ["geheim", "@example.org", "GB82", "Netflix", "Spotify", "1800", "900", "iban"]) expect(json, secret).not.toContain(secret);
    expect(list.find((a) => a.username === "anna")!.volumeClass).toBe("none");
  });
  it("Warnung beim festen Schwellenwert und bei starkem Sprung gegenüber dem Durchschnitt", () => {
    expect(getOperatorAccounts(db, { thresholdCents: 1000, factor: 3 }, NOW).find((a) => a.username === "boss")!.warning).toBe("threshold");
    // Sprung: Vormonate je 300, jetzt 3000 (> 3x den Durchschnitt)
    const big = db.insert(subscriptions).values({ ownerUserId: other, name: "Groß" }).returning().get();
    db.insert(subscriptionPrices).values([{ subscriptionId: big.id, validFromMonth: "2026-08", amountCents: 300 }, { subscriptionId: big.id, validFromMonth: "2026-11", amountCents: 3000 }]).run();
    db.insert(memberships).values({ subscriptionId: big.id, userId: bob, weight: 1, validFromMonth: "2026-08" }).run();
    const w = getOperatorAccounts(db, { thresholdCents: 10_000_000, factor: 3 }, NOW).find((a) => a.username === "other")!;
    expect(w.warning).toBe("jump");
  });
});
