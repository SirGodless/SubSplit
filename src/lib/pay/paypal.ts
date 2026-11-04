/**
 * EINZIGE Stelle, an der der PayPal-Link gebaut wird. Das Format ist nur teilweise belegt:
 * belegt (PayPal-Hilfe) ist, dass der Betrag am Ende des Links steht und die Währung direkt dahinter
 * (z. B. PayPal.Me/DiaRusso/25AUD). Dezimaltrenner, Währungsangabe für EUR und die Domain-Variante
 * paypal.com/paypalme sind nicht ausdrücklich belegt -> hier anpassbar, mit Kleinstbetrag testen.
 */
export interface PaypalLinkFormat {
  baseUrl: string;
  decimalSeparator: "." | ",";
  /** Währungscode direkt hinter den Betrag hängen (z. B. "12.50EUR"). */
  appendCurrency: boolean;
  currency: string;
}

export const DEFAULT_PAYPAL_FORMAT: PaypalLinkFormat = {
  baseUrl: "https://www.paypal.com/paypalme",
  decimalSeparator: ".",
  appendCurrency: true,
  currency: "EUR",
};

export function formatPaypalAmount(cents: number, format: PaypalLinkFormat = DEFAULT_PAYPAL_FORMAT): string {
  if (!Number.isSafeInteger(cents) || cents < 1) throw new Error("PayPal-Betrag muss mindestens 1 Cent sein");
  const amount = `${Math.floor(cents / 100)}${format.decimalSeparator}${String(cents % 100).padStart(2, "0")}`;
  return format.appendCurrency ? `${amount}${format.currency}` : amount;
}

export function buildPaypalLink(paypalMeName: string, cents: number, format: PaypalLinkFormat = DEFAULT_PAYPAL_FORMAT): string {
  if (!/^[A-Za-z0-9]{1,20}$/.test(paypalMeName)) throw new Error("Ungültiger PayPal.Me-Name");
  return `${format.baseUrl.replace(/\/+$/, "")}/${paypalMeName}/${formatPaypalAmount(cents, format)}`;
}
