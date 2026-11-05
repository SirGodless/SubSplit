import { BlockList, isIP } from "node:net";
import { DEFAULT_PAYPAL_FORMAT, type PaypalLinkFormat } from "@/lib/pay/paypal";

/** Wer Einladungslinks erstellen darf und wie viele jedes Konto gleichzeitig offen haben darf. */
export interface InviteSettings {
  creators: "all" | "operator";
  /** 0 = Einladungen ganz abgeschaltet. */
  maxActive: number;
}

export interface Config {
  appName: string;
  baseUrl: string;
  sessionSecret: string;
  /** Schlüssel der Datenbankverschlüsselung (ganze Datei inkl. WAL). Verlust = Datenverlust, getrennt sichern. */
  dbEncryptionKey: string;
  /** Inaktivitäts-Timeout der Sitzung in Sekunden. */
  idleSeconds: number;
  paypalFormat: PaypalLinkFormat;
  securityLogFile: string;
  trustedProxyCidrs: string[];
  databasePath: string;
  migrationsDir: string;
  /** Warnschwelle für die Monatssumme eines Empfängers (Cent) und Faktor gegenüber dem 3-Monats-Durchschnitt. */
  unusualMonthlyTotalCents: number;
  unusualFactor: number;
  invite: InviteSettings;
}

export class ConfigError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Ungültige Konfiguration:\n - ${problems.join("\n - ")}`);
    this.name = "ConfigError";
  }
}

type Env = Record<string, string | undefined>;

/** Prüft eine CIDR-Angabe wie "172.18.0.0/16" oder "fd00::/8". */
export function isValidCidr(value: string): boolean {
  const [addr, prefix, ...rest] = value.split("/");
  if (!addr || prefix === undefined || rest.length > 0) return false;
  const family = isIP(addr);
  if (!family || !/^\d{1,3}$/.test(prefix)) return false;
  try {
    new BlockList().addSubnet(addr, Number(prefix), family === 4 ? "ipv4" : "ipv6");
    return true;
  } catch {
    return false;
  }
}

/**
 * Liest und validiert die Umgebungsvariablen. Es sind nur noch Systemwerte: Benutzer, Empfängerdaten
 * und Fälligkeitstag liegen in der Datenbank (pro Konto). Sammelt alle Fehler, nie Secrets in Meldungen.
 */
export function loadConfig(env: Env = process.env): Config {
  const problems: string[] = [];
  const get = (key: string): string => (env[key] ?? "").trim();
  const required = (key: string, hint = ""): string => {
    const v = get(key);
    if (!v) problems.push(`${key} fehlt${hint ? ` (${hint})` : ""}.`);
    return v;
  };

  const baseUrl = required("BASE_URL", "z. B. https://abos.example.org").replace(/\/+$/, "");
  if (baseUrl) {
    try {
      const u = new URL(baseUrl);
      if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error();
    } catch {
      problems.push("BASE_URL ist keine gültige http(s)-URL.");
    }
  }

  const sessionSecret = required("SESSION_SECRET", "mindestens 32 Zeichen");
  if (sessionSecret && sessionSecret.length < 32) problems.push("SESSION_SECRET ist kürzer als 32 Zeichen.");

  const dbEncryptionKey = required("DB_ENCRYPTION_KEY", "mindestens 32 Zeichen, z. B. openssl rand -hex 32");
  if (dbEncryptionKey && dbEncryptionKey.length < 32) problems.push("DB_ENCRYPTION_KEY ist kürzer als 32 Zeichen.");
  if (dbEncryptionKey && sessionSecret && dbEncryptionKey === sessionSecret) problems.push("DB_ENCRYPTION_KEY und SESSION_SECRET müssen verschieden sein.");

  let idleSeconds = 30 * 60;
  const idleRaw = get("ADMIN_IDLE_TIMEOUT_MINUTES");
  if (idleRaw) {
    const m = Number(idleRaw);
    if (!/^\d{1,4}$/.test(idleRaw) || m < 1 || m > 1440) problems.push("ADMIN_IDLE_TIMEOUT_MINUTES muss eine ganze Zahl von 1 bis 1440 (Minuten) sein.");
    else idleSeconds = m * 60;
  }

  // PayPal-Linkformat (nur Host-Allowlist, damit ein Tippfehler keine Zahlungen an fremde Seiten lenkt)
  const paypalFormat: PaypalLinkFormat = { ...DEFAULT_PAYPAL_FORMAT };
  const baseRaw = get("PAYPAL_LINK_BASE");
  if (baseRaw) {
    try {
      const u = new URL(baseRaw);
      if (u.protocol !== "https:" || !["www.paypal.com", "paypal.com", "www.paypal.me", "paypal.me"].includes(u.hostname) || u.search || u.hash) throw new Error();
      paypalFormat.baseUrl = baseRaw.replace(/\/+$/, "");
    } catch {
      problems.push("PAYPAL_LINK_BASE muss eine https-URL auf paypal.com oder paypal.me ohne Parameter sein (z. B. https://www.paypal.com/paypalme).");
    }
  }
  const decRaw = get("PAYPAL_DECIMAL").toLowerCase();
  if (decRaw === "comma") paypalFormat.decimalSeparator = ",";
  else if (decRaw === "dot") paypalFormat.decimalSeparator = ".";
  else if (decRaw) problems.push('PAYPAL_DECIMAL muss "dot" oder "comma" sein.');
  const curRaw = get("PAYPAL_APPEND_CURRENCY").toLowerCase();
  if (curRaw === "true") paypalFormat.appendCurrency = true;
  else if (curRaw === "false") paypalFormat.appendCurrency = false;
  else if (curRaw) problems.push('PAYPAL_APPEND_CURRENCY muss "true" oder "false" sein.');

  let unusualMonthlyTotalCents = 500 * 100;
  const thrRaw = get("UNUSUAL_MONTHLY_TOTAL_EUR");
  if (thrRaw) {
    if (!/^\d{1,7}$/.test(thrRaw) || Number(thrRaw) < 1) problems.push("UNUSUAL_MONTHLY_TOTAL_EUR muss eine ganze Zahl >= 1 (Euro) sein.");
    else unusualMonthlyTotalCents = Number(thrRaw) * 100;
  }
  let unusualFactor = 3;
  const facRaw = get("UNUSUAL_FACTOR");
  if (facRaw) {
    if (!/^\d{1,3}(\.\d{1,2})?$/.test(facRaw) || Number(facRaw) < 1.1) problems.push("UNUSUAL_FACTOR muss eine Zahl >= 1.1 sein.");
    else unusualFactor = Number(facRaw);
  }

  const invite: InviteSettings = { creators: "all", maxActive: 5 };
  const credRaw = get("INVITATIONS_CREATORS").toLowerCase();
  if (credRaw === "all" || credRaw === "operator") invite.creators = credRaw;
  else if (credRaw) problems.push('INVITATIONS_CREATORS muss "all" oder "operator" sein.');
  const maxRaw = get("INVITATIONS_MAX_ACTIVE");
  if (maxRaw) {
    if (!/^\d{1,3}$/.test(maxRaw) || Number(maxRaw) > 100) problems.push("INVITATIONS_MAX_ACTIVE muss eine ganze Zahl von 0 bis 100 sein (0 = Einladungen abgeschaltet).");
    else invite.maxActive = Number(maxRaw);
  }

  const trustedProxyCidrs = get("TRUSTED_PROXY_CIDR")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const cidr of trustedProxyCidrs) {
    if (!isValidCidr(cidr)) problems.push(`TRUSTED_PROXY_CIDR enthält einen ungültigen Eintrag: "${cidr}".`);
  }

  if (problems.length > 0) throw new ConfigError(problems);

  return {
    appName: get("APP_NAME") || "SubSplit",
    baseUrl,
    sessionSecret,
    dbEncryptionKey,
    idleSeconds,
    paypalFormat,
    securityLogFile: get("SECURITY_LOG_FILE") || "/logs/security.log",
    trustedProxyCidrs,
    databasePath: get("DATABASE_PATH") || "/data/subsplit.db",
    migrationsDir: get("MIGRATIONS_DIR") || "./drizzle",
    unusualMonthlyTotalCents,
    unusualFactor,
    invite,
  };
}

let cached: Config | undefined;
export function getConfig(): Config {
  return (cached ??= loadConfig());
}
