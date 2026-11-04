export interface EpcInput {
  name: string;
  iban: string;
  amountCents: number;
  /** Verwendungszweck (unstrukturiert), max. 140 Zeichen. */
  remittance: string;
}

const MAX_NAME = 70;
const MAX_REMITTANCE = 140;
const MAX_AMOUNT_CENTS = 99_999_999_999; // 999.999.999,99

const clean = (s: string) => s.replace(/[\r\n]+/g, " ").trim();

export function formatEpcAmount(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents < 1 || cents > MAX_AMOUNT_CENTS) throw new Error("EPC-Betrag muss zwischen 0,01 und 999.999.999,99 EUR liegen");
  const euros = Math.floor(cents / 100);
  return `EUR${euros}.${String(cents % 100).padStart(2, "0")}`;
}

/**
 * EPC-QR-Payload (GiroCode, EPC069-12), Version 002, UTF-8, SCT, BIC leer.
 * Zeilen: Service-Tag, Version, Zeichensatz (1 = UTF-8), Identifikation, BIC, Name, IBAN,
 * Betrag, Zweck, Gläubiger-Referenz (strukturiert), Verwendungszweck (unstrukturiert).
 */
export function buildEpcPayload(input: EpcInput): string {
  const name = clean(input.name);
  const remittance = clean(input.remittance);
  const iban = input.iban.replace(/\s+/g, "").toUpperCase();
  if (!name || [...name].length > MAX_NAME) throw new Error(`Empfängername muss 1-${MAX_NAME} Zeichen lang sein`);
  if (!iban) throw new Error("IBAN fehlt");
  if ([...remittance].length > MAX_REMITTANCE) throw new Error(`Verwendungszweck darf höchstens ${MAX_REMITTANCE} Zeichen haben`);
  return ["BCD", "002", "1", "SCT", "", name, iban, formatEpcAmount(input.amountCents), "", "", remittance].join("\n");
}
