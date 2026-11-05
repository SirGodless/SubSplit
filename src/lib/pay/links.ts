import QRCode from "qrcode";
import { buildEpcPayload } from "./epc";
import { buildPaypalLink, type PaypalLinkFormat } from "./paypal";

export interface RecipientInfo {
  /** Empfängername für den GiroCode. */
  name: string;
  /** Beides optional, mindestens eines ist vorhanden. */
  paypalMe: string | null;
  iban: string | null;
  appName: string;
  paypalFormat?: PaypalLinkFormat;
}

export interface PaymentLinks {
  referenceId: string;
  /** "<ID> <App-Name> <JJJJ-MM>" (bei Rückstand mit Zusatz). */
  remittance: string;
  paypal: { url: string; qrSvg: string } | null;
  bank: { giroCodeSvg: string; iban: string; recipientName: string } | null;
}

export const buildRemittance = (referenceId: string, appName: string, month: string, withArrears = false) =>
  `${referenceId} ${appName} ${month}${withArrears ? " inkl. Rückstand" : ""}`;

const qrSvg = (text: string) => QRCode.toString(text, { type: "svg", errorCorrectionLevel: "M", margin: 2 });

/**
 * Genau ein Link-Satz pro Empfänger (Gesamtbetrag aus laufendem Monat plus Rückstand), nie pro Abo.
 * `month` ist der Monat der Referenz-ID (die neueste offene Zahlung).
 */
export async function buildPaymentLinks(
  r: RecipientInfo,
  p: { referenceId: string; month: string; amountCents: number; withArrears?: boolean },
): Promise<PaymentLinks> {
  const remittance = buildRemittance(p.referenceId, r.appName, p.month, p.withArrears);
  let paypal: PaymentLinks["paypal"] = null;
  if (r.paypalMe) {
    const url = buildPaypalLink(r.paypalMe, p.amountCents, r.paypalFormat);
    paypal = { url, qrSvg: await qrSvg(url) };
  }
  let bank: PaymentLinks["bank"] = null;
  if (r.iban) {
    const epc = buildEpcPayload({ name: r.name, iban: r.iban, amountCents: p.amountCents, remittance });
    bank = { giroCodeSvg: await qrSvg(epc), iban: r.iban, recipientName: r.name };
  }
  return { referenceId: p.referenceId, remittance, paypal, bank };
}
