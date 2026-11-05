import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { openDatabase, runMigrations, type Db } from "@/db/client";
import { emailVerifications, mailOutbox, users } from "@/db/schema";
import type { MailTransport, OutgoingMail } from "@/lib/mail/transport";
import type { SecurityLogger } from "@/lib/security/security-log";
import { AppError } from "@/lib/services/errors";
import {
  applyUnsubscribe, confirmEmailVerification, peekEmailVerification, requestTestMail, setNotificationPrefs, startEmailVerification, unsubscribeLinks, type MailCtx,
} from "@/lib/services/email";
import { BACKOFF_MINUTES, enqueueMail, MAX_ATTEMPTS, processOutbox, purgeOldMail, safeError } from "@/lib/services/mail";
import { createUser, setDisabled, updateProfile } from "@/lib/services/users";

const NOW = new Date("2026-11-04T10:00:00Z");
const CTX: MailCtx = { appName: "SubSplit", baseUrl: "https://abos.example.org", secret: "s".repeat(40) };
let db: Db;
let calls: string[];
const logger: SecurityLogger = { authFail: (ip, r) => calls.push(`FAIL ${ip} ${r}`), notice: (ip, r) => calls.push(`NOTICE ${ip} ${r}`) };

class FakeTransport implements MailTransport {
  sent: OutgoingMail[] = [];
  failWith: Error | null = null;
  async send(m: OutgoingMail) {
    if (this.failWith) throw this.failWith;
    this.sent.push(m);
  }
  async verify() {}
}

let anna: number;
const mins = (n: number, from = NOW) => new Date(from.getTime() + n * 60_000);
const outbox = () => db.select().from(mailOutbox).all();
const verified = (id: number, email: string) => db.update(users).set({ email, emailVerifiedAt: NOW.toISOString() }).where(eq(users.id, id)).run();

beforeEach(() => {
  const h = openDatabase(":memory:");
  runMigrations(h, "./drizzle");
  db = h.db;
  calls = [];
  anna = createUser(db, { username: "anna", displayName: "Anna" });
});

describe("Postausgang", () => {
  it("dieselbe Mail (dedupe_key) wird nur einmal angelegt", () => {
    verified(anna, "anna@example.org");
    const mail = { toUserId: anna, toAddress: "anna@example.org", type: "price_change" as const, dedupeKey: "k1", subject: "S", bodyText: "T" };
    expect(enqueueMail(db, mail, NOW)).toBeGreaterThan(0);
    expect(enqueueMail(db, mail, NOW)).toBeNull();
    expect(outbox()).toHaveLength(1);
  });
  it("Versand: Mail geht raus, danach sind Adresse und Text gelöscht (Datensparsamkeit)", async () => {
    verified(anna, "anna@example.org");
    enqueueMail(db, { toUserId: anna, toAddress: "anna@example.org", type: "price_change", subject: "Betreff", bodyText: "Geheimer Inhalt", unsubscribeUrl: "https://x/u" }, NOW);
    const t = new FakeTransport();
    expect(await processOutbox(db, t, NOW)).toEqual({ sent: 1, retried: 0, failed: 0 });
    expect(t.sent).toEqual([{ to: "anna@example.org", subject: "Betreff", text: "Geheimer Inhalt", unsubscribeUrl: "https://x/u" }]);
    const row = outbox()[0]!;
    expect(row).toMatchObject({ status: "sent", attempts: 1, bodyText: "", toAddress: null, lastError: null });
    expect(row.sentAt).toBe(NOW.toISOString());
    expect((await processOutbox(db, t, NOW)).sent).toBe(0); // nichts doppelt
  });
  it("Fehler: Wiederholung mit wachsendem Abstand, nach 5 Versuchen 'failed'; Adresse nicht im Fehlertext", async () => {
    verified(anna, "anna@example.org");
    enqueueMail(db, { toUserId: anna, toAddress: "anna@example.org", type: "price_change", subject: "S", bodyText: "T" }, NOW);
    const t = new FakeTransport();
    t.failWith = new Error("550 5.1.1 <anna@example.org> Recipient rejected");
    let now = NOW;
    for (let attempt = 1; attempt < MAX_ATTEMPTS; attempt++) {
      expect(await processOutbox(db, t, now)).toMatchObject({ retried: 1 });
      const row = outbox()[0]!;
      expect(row.attempts).toBe(attempt);
      expect(row.nextAttemptAt).toBe(mins(BACKOFF_MINUTES[attempt - 1]!, now).toISOString());
      expect(row.lastError).not.toContain("anna@example.org");
      expect(await processOutbox(db, t, mins(1, now))).toEqual({ sent: 0, retried: 0, failed: 0 }); // noch nicht fällig
      now = new Date(row.nextAttemptAt);
    }
    expect(await processOutbox(db, t, now)).toMatchObject({ failed: 1 });
    expect(outbox()[0]).toMatchObject({ status: "failed", attempts: MAX_ATTEMPTS, bodyText: "", toAddress: null });
    expect(safeError(new Error("x".repeat(500))).length).toBe(200);
  });
  it("vor dem Versand wird geprüft: Adresse unverändert und bestätigt, Konto aktiv, Einstellung an", async () => {
    verified(anna, "anna@example.org");
    const t = new FakeTransport();
    const q = (type: "reminder" | "price_change", key: string) => enqueueMail(db, { toUserId: anna, toAddress: "anna@example.org", type, dedupeKey: key, subject: "S", bodyText: "T" }, NOW);
    q("price_change", "a"); updateProfile(db, anna, { email: "neu@example.org" }); // Adresse geändert -> nicht mehr bestätigt
    expect((await processOutbox(db, t, NOW)).failed).toBe(1);
    expect(outbox()[0]!.lastError).toMatch(/nicht mehr bestätigt/);
    verified(anna, "anna@example.org");
    setNotificationPrefs(db, anna, { remindersEnabled: false, priceMailsEnabled: false });
    q("reminder", "b"); q("price_change", "c");
    expect((await processOutbox(db, t, NOW)).failed).toBe(2);
    setNotificationPrefs(db, anna, { remindersEnabled: true, priceMailsEnabled: true });
    q("reminder", "d");
    const op = createUser(db, { username: "chef", displayName: "Chef", role: "operator" });
    setDisabled(db, anna, true, op, NOW);
    expect((await processOutbox(db, t, NOW)).failed).toBe(1);
    expect(t.sent).toEqual([]);
  });
  it("Aufräumen: erledigte Mails nach 60 Tagen, offene bleiben", () => {
    verified(anna, "anna@example.org");
    const old = new Date(NOW.getTime() - 61 * 24 * 3600 * 1000);
    const a = enqueueMail(db, { toUserId: anna, toAddress: "a@example.org", type: "test", subject: "S", bodyText: "T" }, old)!;
    const b = enqueueMail(db, { toUserId: anna, toAddress: "a@example.org", type: "test", subject: "S", bodyText: "T" }, old)!;
    db.update(mailOutbox).set({ status: "sent" }).where(eq(mailOutbox.id, a)).run();
    purgeOldMail(db, NOW);
    expect(outbox().map((r) => r.id)).toEqual([b]);
  });
});

describe("E-Mail-Adresse bestätigen", () => {
  it("Ablauf: Link per Mail, einmalig gültig, danach ist die Adresse bestätigt", async () => {
    updateProfile(db, anna, { email: "anna@example.org" });
    startEmailVerification(db, CTX, anna, NOW);
    const t = new FakeTransport();
    await processOutbox(db, t, NOW);
    expect(t.sent[0]!.to).toBe("anna@example.org"); // Bestätigungsmail geht auch an die noch unbestätigte Adresse
    const token = /\/verify-email\/([A-Za-z0-9_-]{43})/.exec(t.sent[0]!.text)![1]!;
    expect(db.select().from(users).where(eq(users.id, anna)).get()!.emailVerifiedAt).toBeNull();
    expect(peekEmailVerification(db, token, "1.2.3.4", logger, NOW)).toBe(true);
    confirmEmailVerification(db, token, NOW);
    expect(db.select().from(users).where(eq(users.id, anna)).get()!.emailVerifiedAt).toBe(NOW.toISOString());
    expect(() => confirmEmailVerification(db, token, NOW)).toThrow(/ungültig oder abgelaufen/);
    expect(peekEmailVerification(db, token, "1.2.3.4", logger, NOW)).toBe(false);
    expect(calls).toEqual(["NOTICE 1.2.3.4 revoked_token"]); // benutzt: kein Ban
    expect(db.select().from(emailVerifications).all()[0]!.tokenHash).not.toContain(token); // nur als Hash gespeichert
  });
  it("unbekannter Link -> AUTHFAIL ohne Token im Log; abgelaufener Link -> NOTICE; ungültig beim Bestätigen", () => {
    updateProfile(db, anna, { email: "anna@example.org" });
    expect(peekEmailVerification(db, "A".repeat(43), "1.2.3.4", logger, NOW)).toBe(false);
    expect(calls).toEqual(["FAIL 1.2.3.4 invalid_token"]);
    startEmailVerification(db, CTX, anna, NOW);
    const token = /\/verify-email\/(\S+)/.exec(outbox()[0]!.bodyText)![1]!;
    const later = new Date(NOW.getTime() + 49 * 3600 * 1000);
    expect(peekEmailVerification(db, token, "1.2.3.4", logger, later)).toBe(false);
    expect(() => confirmEmailVerification(db, token, later)).toThrow(AppError);
    expect(calls[1]).toBe("NOTICE 1.2.3.4 revoked_token");
  });
  it("wurde die Adresse inzwischen geändert, bestätigt der alte Link nichts", () => {
    updateProfile(db, anna, { email: "alt@example.org" });
    startEmailVerification(db, CTX, anna, NOW);
    const token = /\/verify-email\/(\S+)/.exec(outbox()[0]!.bodyText)![1]!;
    updateProfile(db, anna, { email: "neu@example.org" });
    expect(() => confirmEmailVerification(db, token, NOW)).toThrow(AppError);
    expect(db.select().from(users).where(eq(users.id, anna)).get()!.emailVerifiedAt).toBeNull();
  });
  it("Adresswechsel setzt die Bestätigung zurück, gleiche Adresse nicht", () => {
    verified(anna, "anna@example.org");
    updateProfile(db, anna, { email: "anna@example.org", displayName: "Anna M." });
    expect(db.select().from(users).where(eq(users.id, anna)).get()!.emailVerifiedAt).not.toBeNull();
    updateProfile(db, anna, { email: "andere@example.org" });
    expect(db.select().from(users).where(eq(users.id, anna)).get()).toMatchObject({ email: "andere@example.org", emailVerifiedAt: null });
    updateProfile(db, anna, { email: null });
    expect(db.select().from(users).where(eq(users.id, anna)).get()!.email).toBeNull();
  });
  it("ohne Adresse oder schon bestätigt: Fehler; höchstens 3 Bestätigungsmails pro Stunde", () => {
    expect(() => startEmailVerification(db, CTX, anna, NOW)).toThrow(/keine E-Mail-Adresse/);
    updateProfile(db, anna, { email: "anna@example.org" });
    for (let i = 0; i < 3; i++) startEmailVerification(db, CTX, anna, NOW);
    expect(() => startEmailVerification(db, CTX, anna, NOW)).toThrow(/mehrere Bestätigungsmails/);
    startEmailVerification(db, CTX, anna, new Date(NOW.getTime() + 61 * 60_000)); // nach einer Stunde wieder möglich
    verified(anna, "anna@example.org");
    expect(() => startEmailVerification(db, CTX, anna, NOW)).toThrow(/schon bestätigt/);
  });
});

describe("Test-Mail, Einstellungen, Abmelden", () => {
  it("Test-Mail nur an bestätigte Adresse, höchstens 3 pro Stunde", () => {
    expect(() => requestTestMail(db, CTX, anna, NOW)).toThrow(/eintragen und bestätigen/);
    updateProfile(db, anna, { email: "anna@example.org" });
    expect(() => requestTestMail(db, CTX, anna, NOW)).toThrow(AppError);
    verified(anna, "anna@example.org");
    for (let i = 0; i < 3; i++) requestTestMail(db, CTX, anna, NOW);
    expect(() => requestTestMail(db, CTX, anna, NOW)).toThrow(/mehrere Test-Mails/);
    expect(outbox().every((m) => m.type === "test")).toBe(true);
  });
  it("Abmelde-Link schaltet genau die jeweilige Art von Mails ab, ein gefälschter Link nichts", () => {
    const links = unsubscribeLinks(CTX, anna, "reminders");
    expect(links.page).toMatch(/^https:\/\/abos\.example\.org\/unsubscribe\//);
    expect(links.oneClick).toMatch(/^https:\/\/abos\.example\.org\/api\/unsubscribe\//);
    const token = links.page.split("/unsubscribe/")[1]!;
    expect(applyUnsubscribe(db, CTX.secret, token)).toEqual({ purpose: "reminders" });
    expect(db.select().from(users).where(eq(users.id, anna)).get()).toMatchObject({ remindersEnabled: false, priceMailsEnabled: true });
    expect(applyUnsubscribe(db, CTX.secret, unsubscribeLinks(CTX, anna, "prices").page.split("/unsubscribe/")[1]!)).toEqual({ purpose: "prices" });
    expect(db.select().from(users).where(eq(users.id, anna)).get()!.priceMailsEnabled).toBe(false);
    expect(applyUnsubscribe(db, CTX.secret, token + "x")).toBeNull();
    expect(applyUnsubscribe(db, "anderes-secret-anderes-secret-xxxx", token)).toBeNull();
    setNotificationPrefs(db, anna, { remindersEnabled: true });
    expect(db.select().from(users).where(eq(users.id, anna)).get()!.remindersEnabled).toBe(true);
  });
});
