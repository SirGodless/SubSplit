/**
 * EINZIGE Stelle, an der der PayPal-Link gebaut wird. Das Format ist nur teilweise belegt:
 * belegt (PayPal-Hilfe) ist, dass der Betrag am Ende des Links steht und optional die Währung direkt dahinter
 * (z. B. PayPal.Me/DiaRusso/25AUD). Standard (Praxistest des Betreibers auf einem echten Handy): Basis paypal.me, Komma als
 * Dezimaltrenner, OHNE Währungscode, z. B. https://paypal.me/Name/12,34. Mit "EUR" am Ende öffnete die App nur das Profil. Ohne Code gilt die
 * Standardwährung von PayPal; in der App prüfen, dass Euro angezeigt wird. Per Umgebung umstellbar.
 */
export interface PaypalLinkFormat {
  baseUrl: string;
  decimalSeparator: "." | ",";
  /** Währungscode direkt hinter den Betrag hängen (z. B. "12.50EUR"). */
  appendCurrency: boolean;
  currency: string;
}

export const DEFAULT_PAYPAL_FORMAT: PaypalLinkFormat = {
  baseUrl: "https://paypal.me",
  decimalSeparator: ",",
  appendCurrency: false,
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
