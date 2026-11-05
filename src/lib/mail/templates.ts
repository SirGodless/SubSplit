import { formatDate, formatEuro, formatMonth } from "@/lib/format";

export interface RenderedMail {
  subject: string;
  text: string;
}

const footer = (appName: string, unsubscribeLine?: string) =>
  ["", "--", `Diese Nachricht wurde automatisch von ${appName} verschickt. Antworten auf diese Adresse werden nicht gelesen.`, ...(unsubscribeLine ? [unsubscribeLine] : [])].join("\n");

export function verifyEmailMail(p: { appName: string; name: string; link: string }): RenderedMail {
  return {
    subject: `Bitte bestätige deine E-Mail-Adresse (${p.appName})`,
    text: [
      `Hallo ${p.name},`,
      "",
      `bitte bestätige diese E-Mail-Adresse für dein Konto bei ${p.appName}:`,
      p.link,
      "",
      "Der Link ist 48 Stunden gültig. Erst danach bekommst du Erinnerungen und Infos per E-Mail.",
      "Wenn du das nicht angefordert hast, ignoriere diese Nachricht einfach.",
      footer(p.appName),
    ].join("\n"),
  };
}

export function testMail(p: { appName: string; name: string }): RenderedMail {
  return {
    subject: `Test-Mail von ${p.appName}`,
    text: [`Hallo ${p.name},`, "", `das ist eine Test-Mail von ${p.appName}. Wenn du sie liest, funktioniert der Versand an deine Adresse.`, footer(p.appName)].join("\n"),
  };
}

export function reminderMail(p: {
  appName: string;
  name: string;
  recipientName: string;
  totalCents: number;
  /** Offene Monate (laufender Monat plus Rückstand). */
  items: Array<{ month: string; amountCents: number }>;
  referenceId: string;
  /** Fälligkeitsdatum der neuesten offenen Zahlung, "YYYY-MM-DD". */
  dueDate: string;
  payLink: string;
  unsubscribeUrl: string;
}): RenderedMail {
  const arrears = p.items.length > 1;
  return {
    subject: `Erinnerung: ${formatEuro(p.totalCents)} an ${p.recipientName} noch offen`,
    text: [
      `Hallo ${p.name},`,
      "",
      `bei ${p.recipientName} steht noch ein Betrag von ${formatEuro(p.totalCents)} offen. Fällig war er am ${formatDate(p.dueDate)}.`,
      ...(arrears ? ["", "Er setzt sich zusammen aus:", ...p.items.map((i) => `  ${formatMonth(i.month)}: ${formatEuro(i.amountCents)}`)] : []),
      "",
      `Referenz-ID: ${p.referenceId}`,
      "Bitte gib sie beim Bezahlen an (PayPal-Notiz bzw. Verwendungszweck).",
      "",
      "Zahlungsdaten und Aufschlüsselung findest du nach der Anmeldung hier:",
      p.payLink,
      "",
      "Schon bezahlt? Dann tippe dort auf „Ich habe bezahlt“. Hast du einen Dauerauftrag eingerichtet, schalte ihn dort ein, dann bekommst du keine Erinnerungen mehr.",
      footer(p.appName, `Keine Zahlungserinnerungen mehr erhalten: ${p.unsubscribeUrl}`),
    ].join("\n"),
  };
}

export function priceChangeMail(p: {
  appName: string;
  name: string;
  ownerName: string;
  subscriptionName: string;
  /** Erster Monat mit dem neuen Preis. */
  month: string;
  oldPriceCents: number | null;
  newPriceCents: number;
  oldShareCents: number | null;
  newShareCents: number;
  oldTotalCents: number | null;
  newTotalCents: number;
  hasStandingOrder: boolean;
  payLink: string;
  unsubscribeUrl: string;
}): RenderedMail {
  const arrow = (a: number | null, b: number) => (a === null ? formatEuro(b) : `${formatEuro(a)} → ${formatEuro(b)}`);
  return {
    subject: `Preisänderung bei „${p.subscriptionName}“ ab ${formatMonth(p.month)}`,
    text: [
      `Hallo ${p.name},`,
      "",
      `${p.ownerName} hat den Preis für „${p.subscriptionName}“ geändert. Ab ${formatMonth(p.month)} gilt:`,
      `  Preis pro Monat: ${arrow(p.oldPriceCents, p.newPriceCents)}`,
      `  Dein Anteil an diesem Abo: ${arrow(p.oldShareCents, p.newShareCents)}`,
      `  Dein Gesamtbetrag bei ${p.ownerName} pro Monat: ${arrow(p.oldTotalCents, p.newTotalCents)}`,
      "",
      "Bis dahin ändert sich nichts.",
      ...(p.hasStandingOrder
        ? ["", `Du hast bei ${p.ownerName} einen Dauerauftrag eingetragen. Bitte passe ihn ab ${formatMonth(p.month)} auf ${formatEuro(p.newTotalCents)} an.`]
        : []),
      "",
      "Details nach der Anmeldung:",
      p.payLink,
      footer(p.appName, `Keine Infos zu Preisänderungen mehr erhalten: ${p.unsubscribeUrl}`),
    ].join("\n"),
  };
}
