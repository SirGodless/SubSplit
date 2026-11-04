import { BlockList, isIP } from "node:net";
import { isValidIban, normalizeIban } from "./iban";

export interface Config {
  appName: string;
  baseUrl: string;
  adminUsername: string;
  adminPasswordHash: string;
  sessionSecret: string;
  recipientName: string;
  recipientPaypalMe: string;
  recipientIban: string;
  dueDay: number;
  securityLogFile: string;
  trustedProxyCidrs: string[];
  databasePath: string;
  migrationsDir: string;
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
 * Liest und validiert alle Umgebungsvariablen. Sammelt alle Fehler und wirft
 * einmal ConfigError – nie Secrets in Fehlermeldungen.
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

  const adminUsername = get("ADMIN_USERNAME") || "admin";
  const adminPasswordHash = required("ADMIN_PASSWORD_HASH");
  const sessionSecret = required("SESSION_SECRET", "mindestens 32 Zeichen");
  if (sessionSecret && sessionSecret.length < 32) problems.push("SESSION_SECRET ist kürzer als 32 Zeichen.");

  const recipientName = required("RECIPIENT_NAME");
  if (recipientName.length > 70) problems.push("RECIPIENT_NAME ist länger als 70 Zeichen (EPC-Limit).");

  const recipientPaypalMe = required("RECIPIENT_PAYPAL_ME", "nur der Name nach paypal.me/");
  if (recipientPaypalMe && !/^[A-Za-z0-9]{1,20}$/.test(recipientPaypalMe)) {
    problems.push("RECIPIENT_PAYPAL_ME darf nur Buchstaben und Ziffern enthalten (max. 20 Zeichen), ohne 'paypal.me/'.");
  }

  const ibanRaw = required("RECIPIENT_IBAN");
  if (ibanRaw && !isValidIban(ibanRaw)) problems.push("RECIPIENT_IBAN hat eine ungültige Prüfsumme oder ein ungültiges Format.");

  let dueDay = 1;
  const dueRaw = get("DUE_DAY");
  if (dueRaw) {
    dueDay = Number(dueRaw);
    if (!/^\d{1,2}$/.test(dueRaw) || dueDay < 1 || dueDay > 28) {
      problems.push("DUE_DAY muss eine ganze Zahl von 1 bis 28 sein.");
      dueDay = 1;
    }
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
    adminUsername,
    adminPasswordHash,
    sessionSecret,
    recipientName,
    recipientPaypalMe,
    recipientIban: normalizeIban(ibanRaw),
    dueDay,
    securityLogFile: get("SECURITY_LOG_FILE") || "/logs/security.log",
    trustedProxyCidrs,
    databasePath: get("DATABASE_PATH") || "/data/subsplit.db",
    migrationsDir: get("MIGRATIONS_DIR") || "./drizzle",
  };
}

let cached: Config | undefined;
export function getConfig(): Config {
  return (cached ??= loadConfig());
}
