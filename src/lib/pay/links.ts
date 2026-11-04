import QRCode from "qrcode";
import { buildEpcPayload } from "./epc";
import { buildPaypalLink } from "./paypal";

export interface RecipientInfo {
  name: string;
  paypalMe: string;
  iban: string;
  appName: string;
}

export interface PaymentLinks {
  referenceId: string;
  /** "<ID> <App-Name> <JJJJ-MM>" */
  remittance: string;
  paypalUrl: string;
  paypalQrSvg: string;
  giroCodeSvg: string;
  recipientName: string;
  iban: string;
}

export const buildRemittance = (referenceId: string, appName: string, month: string) => `${referenceId} ${appName} ${month}`;

const qrSvg = (text: string) => QRCode.toString(text, { type: "svg", errorCorrectionLevel: "M", margin: 2 });

/** Genau ein Link-Satz pro Monatszahlung (Gesamtbetrag). Nie pro Abo. */
export async function buildPaymentLinks(r: RecipientInfo, p: { referenceId: string; month: string; amountCents: number }): Promise<PaymentLinks> {
  const remittance = buildRemittance(p.referenceId, r.appName, p.month);
  const paypalUrl = buildPaypalLink(r.paypalMe, p.amountCents);
  const epc = buildEpcPayload({ name: r.name, iban: r.iban, amountCents: p.amountCents, remittance });
  const [paypalQrSvg, giroCodeSvg] = await Promise.all([qrSvg(paypalUrl), qrSvg(epc)]);
  return { referenceId: p.referenceId, remittance, paypalUrl, paypalQrSvg, giroCodeSvg, recipientName: r.name, iban: r.iban };
}
