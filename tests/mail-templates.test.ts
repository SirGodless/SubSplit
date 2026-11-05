import { describe, expect, it } from "vitest";
import { makeUnsubscribeToken, readUnsubscribeToken } from "@/lib/mail/tokens";
import { priceChangeMail, reminderMail, testMail, verifyEmailMail } from "@/lib/mail/templates";

const SECRET = "s".repeat(40);
/** Die Euro-Formatierung nutzt ein geschütztes Leerzeichen; für den Vergleich normalisieren. */
const n = <T extends { subject: string; text: string }>(m: T): T => ({ ...m, subject: m.subject.replace(/\u00a0/g, " "), text: m.text.replace(/\u00a0/g, " ") });

describe("Mail-Texte", () => {
  it("Erinnerung: Betrag, Referenz-ID, Link und Abmelde-Link; nie IBAN oder PayPal", () => {
    const m = n(reminderMail({
      appName: "SubSplit", name: "Anna", recipientName: "Joshua", totalCents: 1332,
      items: [{ month: "2026-10", amountCents: 666 }, { month: "2026-11", amountCents: 666 }],
      referenceId: "K7M2QX", dueDate: "2026-11-01", payLink: "https://abos.example.org/pay/1", unsubscribeUrl: "https://abos.example.org/unsubscribe/xyz",
    }));
    expect(m.subject).toBe("Erinnerung: 13,32 € an Joshua noch offen");
    for (const part of ["Hallo Anna", "13,32", "01.11.2026", "K7M2QX", "https://abos.example.org/pay/1", "Oktober 2026: 6,66", "November 2026: 6,66", "https://abos.example.org/unsubscribe/xyz", "Antworten auf diese Adresse werden nicht gelesen"])
      expect(m.text, part).toContain(part);
    expect(m.text).not.toMatch(/IBAN|paypal\.me|DE\d{2}\s?\d{4}/i);
  });
  it("Erinnerung ohne Rückstand zeigt keine Aufschlüsselung", () => {
    const m = reminderMail({ appName: "SubSplit", name: "A", recipientName: "J", totalCents: 500, items: [{ month: "2026-11", amountCents: 500 }], referenceId: "ABCDEF", dueDate: "2026-11-01", payLink: "x", unsubscribeUrl: "y" });
    expect(m.text).not.toContain("setzt sich zusammen");
  });
  it("Preisänderung: alter und neuer Wert, Dauerauftrag-Hinweis nur mit Dauerauftrag", () => {
    const base = {
      appName: "SubSplit", name: "Bob", ownerName: "Joshua", subscriptionName: "Netflix", month: "2026-12", oldPriceCents: 1800, newPriceCents: 2000,
      oldShareCents: 900, newShareCents: 1000, oldTotalCents: 1500, newTotalCents: 1700, payLink: "https://x/pay/1", unsubscribeUrl: "https://x/u",
    };
    const without = n(priceChangeMail({ ...base, hasStandingOrder: false }));
    expect(without.subject).toBe("Preisänderung bei „Netflix“ ab Dezember 2026");
    for (const part of ["18,00 € → 20,00 €", "9,00 € → 10,00 €", "15,00 € → 17,00 €", "Bis dahin ändert sich nichts"]) expect(without.text, part).toContain(part);
    expect(without.text).not.toContain("Dauerauftrag");
    const withOrder = n(priceChangeMail({ ...base, hasStandingOrder: true }));
    expect(withOrder.text).toContain("Bitte passe ihn ab Dezember 2026 auf 17,00 € an");
  });
  it("Bestätigungs- und Test-Mail haben keinen Abmelde-Link, aber den Hinweis auf Antworten", () => {
    for (const m of [verifyEmailMail({ appName: "SubSplit", name: "A", link: "https://x/verify-email/t" }), testMail({ appName: "SubSplit", name: "A" })]) {
      expect(m.text).not.toContain("mehr erhalten");
      expect(m.text).toContain("nicht gelesen");
    }
    expect(verifyEmailMail({ appName: "S", name: "A", link: "https://x/v" }).text).toContain("48 Stunden");
  });
});

describe("Abmelde-Token", () => {
  it("signiert, nicht fälschbar, mit Art der Mails", () => {
    const t = makeUnsubscribeToken(SECRET, 42, "reminders");
    expect(readUnsubscribeToken(SECRET, t)).toEqual({ userId: 42, purpose: "reminders" });
    expect(readUnsubscribeToken(SECRET, makeUnsubscribeToken(SECRET, 42, "prices"))?.purpose).toBe("prices");
    expect(readUnsubscribeToken("anderes-secret-anderes-secret-xxxx", t)).toBeNull();
    const [data] = t.split(".");
    expect(readUnsubscribeToken(SECRET, `${data}.AAAA`)).toBeNull();
    expect(readUnsubscribeToken(SECRET, `${Buffer.from("43:reminders").toString("base64url")}.${t.split(".")[1]}`)).toBeNull(); // andere Konto-ID, alte Signatur
    expect(readUnsubscribeToken(SECRET, "müll")).toBeNull();
    expect(readUnsubscribeToken(SECRET, "")).toBeNull();
  });
});
