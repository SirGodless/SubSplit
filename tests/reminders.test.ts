import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { openDatabase, runMigrations, type Db } from "@/db/client";
import { mailOutbox, memberships, payments, subscriptionPrices, subscriptions, users } from "@/db/schema";
import type { ReminderSettings } from "@/lib/config";
import { inSendWindow } from "@/lib/billing/month";
import type { MailTransport, OutgoingMail } from "@/lib/mail/transport";
import type { MailCtx } from "@/lib/services/email";
import { createSubscription, setMembership, setPrice } from "@/lib/services/manage";
import { processOutbox } from "@/lib/services/mail";
import { ensureOwnerPayments, setPaidByPayer, setStatusByOwner } from "@/lib/services/payments";
import { enqueueDueReminders } from "@/lib/services/reminders";
import { setPriceAndNotify } from "@/lib/services/notify";
import { setStandingOrder } from "@/lib/services/standing-orders";
import { createUser, setDisabled, updateRecipient } from "@/lib/services/users";

const M = "2026-11";
const CTX: MailCtx & { settings: ReminderSettings } = { appName: "SubSplit", baseUrl: "https://abos.example.org", secret: "s".repeat(40), settings: { firstDaysAfterDue: 3, repeatDays: 7, maxPerPayment: 3 } };
// Berlin = UTC+1 im November: 10:00 UTC = 11:00 Uhr
const at = (day: number, hourUtc = 10, month = "2026-11") => new Date(`${month}-${String(day).padStart(2, "0")}T${String(hourUtc).padStart(2, "0")}:00:00Z`);
const SETUP = at(1); // Einrichtung am Monatsersten (Berlin 11:00)
let db: Db;
let boss: number, anna: number, bob: number, netflix: number;

class Fake implements MailTransport {
  sent: OutgoingMail[] = [];
  async send(m: OutgoingMail) { this.sent.push(m); }
  async verify() {}
}
const reminders = () => db.select().from(mailOutbox).all().filter((m) => m.type === "reminder");
const verify = (id: number, email: string) => db.update(users).set({ email, emailVerifiedAt: SETUP.toISOString() }).where(eq(users.id, id)).run();
const run = (now: Date, settings = CTX.settings) => enqueueDueReminders(db, { ...CTX, settings }, now);

beforeEach(() => {
  const h = openDatabase(":memory:");
  runMigrations(h, "./drizzle");
  db = h.db;
  boss = createUser(db, { username: "boss", displayName: "Boss" });
  updateRecipient(db, boss, { iban: "GB82 WEST 1234 5698 7654 32" });
  anna = createUser(db, { username: "anna", displayName: "Anna" });
  bob = createUser(db, { username: "bob", displayName: "Bob" });
  verify(anna, "anna@example.org");
  netflix = createSubscription(db, boss, { name: "Netflix", priceCents: 1800, validFromMonth: M }, SETUP);
  setMembership(db, boss, { subscriptionId: netflix, userId: anna, weight: 1, from: M }, SETUP);
  setMembership(db, boss, { subscriptionId: netflix, userId: bob, weight: 1, from: M }, SETUP);
  ensureOwnerPayments(db, boss, SETUP);
});

describe("Zeitfenster", () => {
  it("nur zwischen 8 und 20 Uhr Berlin (Winterzeit UTC+1, Sommerzeit UTC+2)", () => {
    expect(inSendWindow(new Date("2026-11-04T06:59:00Z"))).toBe(false); // 07:59
    expect(inSendWindow(new Date("2026-11-04T07:00:00Z"))).toBe(true); // 08:00
    expect(inSendWindow(new Date("2026-11-04T18:59:00Z"))).toBe(true); // 19:59
    expect(inSendWindow(new Date("2026-11-04T19:00:00Z"))).toBe(false); // 20:00
    expect(inSendWindow(new Date("2026-07-04T05:59:00Z"))).toBe(false); // 07:59 Sommerzeit
    expect(inSendWindow(new Date("2026-07-04T06:00:00Z"))).toBe(true); // 08:00 Sommerzeit
  });
  it("auch ohne dass jemand die App geöffnet hat, entstehen die Zahlungen des neuen Monats für die Erinnerung", () => {
    expect(db.select().from(payments).all().some((p) => p.month === "2026-12")).toBe(false);
    run(at(4, 10, "2026-12"));
    expect(db.select().from(payments).all().some((p) => p.month === "2026-12")).toBe(true);
  });
  it("außerhalb des Fensters wird nichts angelegt, im Fenster am selben Tag schon", () => {
    expect(run(at(4, 3))).toBe(0); // 04:00 Uhr
    expect(run(at(4, 19))).toBe(0); // 20:00 Uhr
    expect(run(at(4, 10))).toBe(1);
  });
});

describe("Rhythmus: 3 Tage nach Fälligkeit, danach wöchentlich, höchstens 3", () => {
  it("Fälligkeit am 1.: erste Erinnerung am 4., zweite am 11., dritte am 18., danach keine mehr", () => {
    expect(run(at(3))).toBe(0); // 2 Tage nach Fälligkeit
    expect(run(at(4))).toBe(1);
    expect(run(at(4, 12))).toBe(0); // nicht doppelt am selben Tag
    expect(run(at(10))).toBe(0); // erst 6 Tage her
    expect(run(at(11))).toBe(1);
    expect(run(at(18))).toBe(1);
    expect(run(at(25))).toBe(0); // Obergrenze 3
    expect(reminders().map((r) => r.dedupeKey!.split(":")[2])).toEqual(["1", "2", "3"]);
  });
  it("neuer Monat, neue Zahlung: der Zähler beginnt von vorn", () => {
    run(at(4)); run(at(11)); run(at(18));
    const dec = "2026-12";
    expect(run(at(3, 10, dec))).toBe(0);
    expect(run(at(4, 10, dec))).toBe(1); // Auslöser ist jetzt die Dezember-Zahlung
    expect(reminders()).toHaveLength(4);
  });
  it("Rhythmus ist einstellbar", () => {
    const s: ReminderSettings = { firstDaysAfterDue: 0, repeatDays: 2, maxPerPayment: 2 };
    expect(run(at(1), s)).toBe(1); // am Fälligkeitstag selbst
    expect(run(at(2), s)).toBe(0);
    expect(run(at(3), s)).toBe(1);
    expect(run(at(5), s)).toBe(0); // Obergrenze 2
  });
  it("der Fälligkeitstag kommt vom Empfänger", () => {
    updateRecipient(db, boss, { dueDay: 10 });
    expect(run(at(12))).toBe(0);
    expect(run(at(13))).toBe(1);
  });
});

describe("Wer keine Mail bekommt", () => {
  it("ohne bestätigte Adresse, bei abgeschalteten Erinnerungen, bei gesperrtem Konto", () => {
    expect(run(at(4))).toBe(1); // nur Anna (Bob hat keine Adresse)
    expect(reminders()).toHaveLength(1);
    db.update(users).set({ email: "bob@example.org" }).where(eq(users.id, bob)).run(); // eingetragen, aber nicht bestätigt
    expect(run(at(4, 12))).toBe(0);
    verify(bob, "bob@example.org");
    db.update(users).set({ remindersEnabled: false }).where(eq(users.id, bob)).run();
    expect(run(at(4, 13))).toBe(0);
    db.update(users).set({ remindersEnabled: true }).where(eq(users.id, bob)).run();
    const op = createUser(db, { username: "chef", displayName: "Chef", role: "operator" });
    setDisabled(db, bob, true, op, at(4));
    expect(run(at(4, 14))).toBe(0);
  });
  it("bezahlt gemeldet oder bestätigt: keine Erinnerung", () => {
    verify(bob, "bob@example.org");
    setPaidByPayer(db, anna, boss, true, at(2));
    const bobPay = db.select().from(payments).all().find((p) => p.payerUserId === bob)!;
    setStatusByOwner(db, boss, bobPay.id, "confirmed", at(2));
    expect(run(at(4))).toBe(0);
  });
  it("Dauerauftrag deckt den Monat ab: keine Erinnerung", () => {
    setStandingOrder(db, anna, { payerUserId: anna, recipientUserId: boss, fromMonth: M }, at(4));
    expect(run(at(4))).toBe(0);
    ensureOwnerPayments(db, boss, at(4));
    expect(db.select().from(payments).all().find((p) => p.payerUserId === anna)!.status).toBe("confirmed");
  });
  it("Dauerauftrag ab Folgemonat: der laufende Monat wird noch erinnert", () => {
    setStandingOrder(db, anna, { payerUserId: anna, recipientUserId: boss, fromMonth: "2026-12" }, at(4));
    expect(run(at(4))).toBe(1);
  });
});

describe("Inhalt und Rückstand", () => {
  it("Rückstand wird zu EINER Mail mit Gesamtbetrag zusammengefasst, Auslöser ist die neueste Zahlung", async () => {
    // Anna ist zusätzlich schon seit Oktober in einem anderen Abo desselben Empfängers
    const old = db.insert(subscriptions).values({ ownerUserId: boss, name: "Alt" }).returning().get();
    db.insert(subscriptionPrices).values({ subscriptionId: old.id, validFromMonth: "2026-10", amountCents: 1000 }).run();
    db.insert(memberships).values({ subscriptionId: old.id, userId: anna, weight: 1, validFromMonth: "2026-10" }).run();
    ensureOwnerPayments(db, boss, at(4));
    expect(run(at(4))).toBe(1);
    const t = new Fake();
    await processOutbox(db, t, at(4));
    expect(t.sent).toHaveLength(1);
    const text = t.sent[0]!.text.replace(/ /g, " ");
    expect(t.sent[0]!.to).toBe("anna@example.org");
    expect(t.sent[0]!.subject.replace(/\u00a0/g, " ")).toBe("Erinnerung: 19,00 € an Boss noch offen"); // Oktober 10,00 + November 9,00
    for (const part of ["Oktober 2026: 10,00", "November 2026: 9,00", "https://abos.example.org/pay/", "Referenz-ID: ", "/unsubscribe/", "nicht gelesen"]) expect(text, part).toContain(part);
    expect(text).not.toMatch(/IBAN|GB82|paypal\.me|paypal\.com/i); // kein Zahlungsziel in der Mail
    expect(t.sent[0]!.unsubscribeUrl).toMatch(/\/api\/unsubscribe\//);
    const novRef = db.select().from(payments).all().find((p) => p.payerUserId === anna && p.month === M)!.referenceId;
    expect(text).toContain(novRef);
  });
  it("nach dem Versand ist im Postausgang nichts Inhaltliches mehr gespeichert", async () => {
    run(at(4));
    await processOutbox(db, new Fake(), at(4));
    expect(reminders()[0]).toMatchObject({ status: "sent", bodyText: "", toAddress: null });
  });
});

describe("Preisänderungs-Mails", () => {
  const NEXT = "2026-12";
  beforeEach(() => {
    db.update(users).set({ email: "bob@example.org" }).where(eq(users.id, bob)).run(); // Bob: Adresse nicht bestätigt
  });
  it("nur an bestätigte Mitzahler des Abos (nie an den Empfänger selbst), mit alten und neuen Werten", async () => {
    const n = setPriceAndNotify(db, CTX, boss, netflix, NEXT, 2000, at(4));
    expect(n).toBe(1); // Anna; Bob ist unbestätigt
    const t = new Fake();
    await processOutbox(db, t, at(4));
    const m = t.sent[0]!;
    const text = m.text.replace(/ /g, " ");
    expect(m.to).toBe("anna@example.org");
    expect(m.subject.replace(/\u00a0/g, " ")).toBe("Preisänderung bei „Netflix“ ab Dezember 2026");
    for (const part of ["18,00 € → 20,00 €", "9,00 € → 10,00 €", "Bis dahin ändert sich nichts", "/pay/", "/unsubscribe/"]) expect(text, part).toContain(part);
    expect(text).not.toContain("Dauerauftrag");
    expect(m.unsubscribeUrl).toMatch(/\/api\/unsubscribe\//);
  });
  it("Zahler mit Dauerauftrag bekommen den Hinweis, ihn anzupassen", async () => {
    setStandingOrder(db, anna, { payerUserId: anna, recipientUserId: boss, fromMonth: M }, at(4));
    setPriceAndNotify(db, CTX, boss, netflix, NEXT, 2000, at(4));
    const t = new Fake();
    await processOutbox(db, t, at(4));
    expect(t.sent[0]!.text.replace(/ /g, " ")).toContain("Bitte passe ihn ab Dezember 2026 auf 10,00 € an");
  });
  it("gleiche Änderung nie doppelt; unveränderter Preis, abgeschaltete Einstellung und fehlender Mailversand: keine Mail", () => {
    expect(setPriceAndNotify(db, CTX, boss, netflix, NEXT, 2000, at(4))).toBe(1);
    expect(setPriceAndNotify(db, CTX, boss, netflix, NEXT, 2000, at(4))).toBe(0); // gleicher Preis
    expect(setPriceAndNotify(db, CTX, boss, netflix, NEXT, 2200, at(4))).toBe(1); // anderer Preis: neue Mail
    db.update(users).set({ priceMailsEnabled: false }).where(eq(users.id, anna)).run();
    expect(setPriceAndNotify(db, CTX, boss, netflix, NEXT, 2400, at(4))).toBe(0);
    db.update(users).set({ priceMailsEnabled: true }).where(eq(users.id, anna)).run();
    expect(setPriceAndNotify(db, null, boss, netflix, NEXT, 2600, at(4))).toBe(0); // Mailversand aus
    // der Preis hat sich trotzdem geändert
    expect(db.select().from(subscriptionPrices).all().find((p) => p.validFromMonth === NEXT)!.amountCents).toBe(2600);
  });
  it("die Preisänderung selbst folgt den Änderungsregeln (nur ab Folgemonat), ohne dass eine Mail rausgeht", () => {
    expect(() => setPriceAndNotify(db, CTX, boss, netflix, M, 2000, at(4))).toThrow(/ab dem Folgemonat/);
    expect(mailCount()).toBe(0);
    expect(() => setPrice(db, boss, netflix, NEXT, 2000, at(4))).not.toThrow();
  });
});

const mailCount = () => db.select().from(mailOutbox).all().length;
