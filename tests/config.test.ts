import { describe, expect, it } from "vitest";
import { ConfigError, isValidCidr, loadConfig } from "@/lib/config";
import { isValidIban } from "@/lib/config/iban";

const valid = {
  BASE_URL: "https://abos.example.org/",
  SESSION_SECRET: "x".repeat(32),
  DB_ENCRYPTION_KEY: "y".repeat(32),
};

function problems(env: Record<string, string | undefined>): string[] {
  try {
    loadConfig(env);
  } catch (e) {
    if (e instanceof ConfigError) return e.problems;
    throw e;
  }
  return [];
}

describe("IBAN", () => {
  it("akzeptiert gültige IBANs (mit Leerzeichen, Kleinbuchstaben)", () => {
    expect(isValidIban("DE89370400440532013000")).toBe(true);
    expect(isValidIban("de89 3704 0044 0532 0130 00")).toBe(true);
    expect(isValidIban("GB82 WEST 1234 5698 7654 32")).toBe(true);
  });
  it("lehnt falsche Prüfsumme und Format ab", () => {
    expect(isValidIban("DE89370400440532013001")).toBe(false);
    expect(isValidIban("DE00")).toBe(false);
    expect(isValidIban("1234567890")).toBe(false);
    expect(isValidIban("")).toBe(false);
  });
});

describe("loadConfig", () => {
  it("lädt eine gültige Konfiguration mit Standardwerten", () => {
    const c = loadConfig(valid);
    expect(c.baseUrl).toBe("https://abos.example.org");
    expect(c.securityLogFile).toBe("/logs/security.log");
    expect(c.databasePath).toBe("/data/subsplit.db");
    expect(c.trustedProxyCidrs).toEqual([]);
    expect(c.appName).toBe("SubSplit");
    expect(c.idleSeconds).toBe(30 * 60);
    expect(c.unusualMonthlyTotalCents).toBe(50000);
    expect(c.unusualFactor).toBe(3);
  });
  it("braucht weder Admin-Zugang noch Empfängerdaten noch Fälligkeitstag (liegen im Konto)", () => {
    expect(problems(valid)).toEqual([]);
  });
  it("sammelt alle Fehler auf einmal", () => {
    expect(problems({}).length).toBeGreaterThanOrEqual(3);
  });
  it("prüft SESSION_SECRET, DB_ENCRYPTION_KEY und BASE_URL", () => {
    expect(problems({ ...valid, SESSION_SECRET: "kurz" }).join()).toMatch(/SESSION_SECRET/);
    expect(problems({ ...valid, DB_ENCRYPTION_KEY: "kurz" }).join()).toMatch(/DB_ENCRYPTION_KEY/);
    expect(problems({ ...valid, DB_ENCRYPTION_KEY: valid.SESSION_SECRET }).join()).toMatch(/verschieden/);
    expect(problems({ ...valid, BASE_URL: "ftp://x" }).join()).toMatch(/BASE_URL/);
  });
  it("gibt Secrets nie in Fehlermeldungen aus", () => {
    const msg = problems({ ...valid, SESSION_SECRET: "geheim", DB_ENCRYPTION_KEY: "auchgeheim" }).join();
    expect(msg).not.toContain("geheim");
    expect(msg).not.toContain("auchgeheim");
  });
  it("validiert TRUSTED_PROXY_CIDR", () => {
    expect(loadConfig({ ...valid, TRUSTED_PROXY_CIDR: "172.18.0.0/16, fd00::/8" }).trustedProxyCidrs).toHaveLength(2);
    expect(problems({ ...valid, TRUSTED_PROXY_CIDR: "172.18.0.0/99" }).join()).toMatch(/TRUSTED_PROXY_CIDR/);
    expect(problems({ ...valid, TRUSTED_PROXY_CIDR: "nonsense" }).join()).toMatch(/TRUSTED_PROXY_CIDR/);
    expect(isValidCidr("10.0.0.0/8")).toBe(true);
    expect(isValidCidr("10.0.0.0")).toBe(false);
  });
});

describe("PayPal-Linkformat per Umgebung", () => {
  it("Standard und Varianten", () => {
    expect(loadConfig(valid).paypalFormat).toEqual({ baseUrl: "https://paypal.me", decimalSeparator: ",", appendCurrency: false, currency: "EUR" });
    const c = loadConfig({ ...valid, PAYPAL_LINK_BASE: "https://www.paypal.com/paypalme/", PAYPAL_APPEND_CURRENCY: "true", PAYPAL_DECIMAL: "dot" });
    expect(c.paypalFormat).toEqual({ baseUrl: "https://www.paypal.com/paypalme", decimalSeparator: ".", appendCurrency: true, currency: "EUR" });
  });
  it("lehnt fremde Hosts, http, Parameter und unbekannte Werte ab", () => {
    for (const bad of ["https://evil.example/paypalme", "http://paypal.com/paypalme", "https://paypal.com.evil.example/x", "https://paypal.me/?a=1", "paypal.me"]) {
      expect(problems({ ...valid, PAYPAL_LINK_BASE: bad }).join(), bad).toMatch(/PAYPAL_LINK_BASE/);
    }
    expect(problems({ ...valid, PAYPAL_DECIMAL: "x" }).join()).toMatch(/PAYPAL_DECIMAL/);
    expect(problems({ ...valid, PAYPAL_APPEND_CURRENCY: "vielleicht" }).join()).toMatch(/PAYPAL_APPEND_CURRENCY/);
  });
});

describe("Inaktivitäts-Timeout und Warnschwellen", () => {
  it("Timeout: Standard 30 Minuten, einstellbar, ungültige Werte abgelehnt", () => {
    expect(loadConfig({ ...valid, ADMIN_IDLE_TIMEOUT_MINUTES: "60" }).idleSeconds).toBe(3600);
    for (const bad of ["0", "-5", "abc", "1.5", "1441"]) expect(problems({ ...valid, ADMIN_IDLE_TIMEOUT_MINUTES: bad }).join(), bad).toMatch(/ADMIN_IDLE_TIMEOUT_MINUTES/);
  });
  it("Warnschwellen einstellbar, ungültige Werte abgelehnt", () => {
    const c = loadConfig({ ...valid, UNUSUAL_MONTHLY_TOTAL_EUR: "1000", UNUSUAL_FACTOR: "2.5" });
    expect(c.unusualMonthlyTotalCents).toBe(100000);
    expect(c.unusualFactor).toBe(2.5);
    for (const bad of ["0", "abc", "-1", "1.5"]) expect(problems({ ...valid, UNUSUAL_MONTHLY_TOTAL_EUR: bad }).join(), bad).toMatch(/UNUSUAL_MONTHLY_TOTAL_EUR/);
    for (const bad of ["1", "abc", "0.5"]) expect(problems({ ...valid, UNUSUAL_FACTOR: bad }).join(), bad).toMatch(/UNUSUAL_FACTOR/);
  });
});

describe("Einladungen per Umgebung", () => {
  it("Standard: alle Konten, 5 gleichzeitig", () => {
    expect(loadConfig(valid).invite).toEqual({ creators: "all", maxActive: 5 });
  });
  it("einstellbar: nur Betreiber, anderes Limit, 0 = abgeschaltet", () => {
    expect(loadConfig({ ...valid, INVITATIONS_CREATORS: "operator", INVITATIONS_MAX_ACTIVE: "12" }).invite).toEqual({ creators: "operator", maxActive: 12 });
    expect(loadConfig({ ...valid, INVITATIONS_CREATORS: "OPERATOR" }).invite.creators).toBe("operator");
    expect(loadConfig({ ...valid, INVITATIONS_MAX_ACTIVE: "0" }).invite.maxActive).toBe(0);
    expect(loadConfig({ ...valid, INVITATIONS_MAX_ACTIVE: "100" }).invite.maxActive).toBe(100);
  });
  it("lehnt ungültige Werte ab", () => {
    for (const bad of ["jeder", "admin", "users"]) expect(problems({ ...valid, INVITATIONS_CREATORS: bad }).join(), bad).toMatch(/INVITATIONS_CREATORS/);
    for (const bad of ["-1", "101", "abc", "2.5", "1000"]) expect(problems({ ...valid, INVITATIONS_MAX_ACTIVE: bad }).join(), bad).toMatch(/INVITATIONS_MAX_ACTIVE/);
  });
});

describe("E-Mail per Umgebung", () => {
  const smtp = { SMTP_HOST: "smtp.example.org", MAIL_FROM: "SubSplit <noreply@anfall.net>" };
  it("ohne SMTP_HOST kein Mailversand, Standard-Rhythmus der Erinnerungen", () => {
    const c = loadConfig(valid);
    expect(c.mail).toBeNull();
    expect(c.reminders).toEqual({ firstDaysAfterDue: 3, repeatDays: 7, maxPerPayment: 3 });
  });
  it("Standardwerte mit STARTTLS und Port 587; Absenderadresse wird erkannt", () => {
    expect(loadConfig({ ...valid, ...smtp }).mail).toEqual({ host: "smtp.example.org", port: 587, security: "starttls", user: null, password: null, from: "SubSplit <noreply@anfall.net>", fromAddress: "noreply@anfall.net" });
    expect(loadConfig({ ...valid, ...smtp, MAIL_FROM: "noreply@anfall.net" }).mail!.fromAddress).toBe("noreply@anfall.net");
  });
  it("Sicherheitsarten, Port-Standard und Zugangsdaten", () => {
    expect(loadConfig({ ...valid, ...smtp, SMTP_SECURITY: "tls" }).mail).toMatchObject({ security: "tls", port: 465 });
    expect(loadConfig({ ...valid, ...smtp, SMTP_SECURITY: "internal", SMTP_HOST: "mail" }).mail).toMatchObject({ security: "internal", port: 587 });
    expect(loadConfig({ ...valid, ...smtp, SMTP_PORT: "2525", SMTP_USER: "u", SMTP_PASSWORD: "p" }).mail).toMatchObject({ port: 2525, user: "u", password: "p" });
  });
  it("lehnt ungültige Angaben ab, nennt nie das Passwort", () => {
    expect(problems({ ...valid, SMTP_HOST: "smtp.example.org" }).join()).toMatch(/MAIL_FROM fehlt/);
    for (const bad of ["kein-absender", "<>", "Name <a@b>", "a b@example.org", "x@@example.org"]) expect(problems({ ...valid, ...smtp, MAIL_FROM: bad }).join(), bad).toMatch(/MAIL_FROM/);
    expect(problems({ ...valid, ...smtp, SMTP_SECURITY: "ssl" }).join()).toMatch(/SMTP_SECURITY/);
    for (const bad of ["0", "70000", "abc"]) expect(problems({ ...valid, ...smtp, SMTP_PORT: bad }).join(), bad).toMatch(/SMTP_PORT/);
    expect(problems({ ...valid, ...smtp, SMTP_USER: "u" }).join()).toMatch(/zusammen gesetzt/);
    const m = problems({ ...valid, ...smtp, SMTP_SECURITY: "internal", SMTP_USER: "u", SMTP_PASSWORD: "geheim-pw" }).join();
    expect(m).toMatch(/internal/);
    expect(m).not.toContain("geheim-pw");
  });
  it("Rhythmus der Erinnerungen einstellbar und geprüft", () => {
    expect(loadConfig({ ...valid, REMINDER_FIRST_DAYS_AFTER_DUE: "2", REMINDER_REPEAT_DAYS: "5", REMINDER_MAX_PER_PAYMENT: "4" }).reminders).toEqual({ firstDaysAfterDue: 2, repeatDays: 5, maxPerPayment: 4 });
    expect(loadConfig({ ...valid, REMINDER_FIRST_DAYS_AFTER_DUE: "0" }).reminders.firstDaysAfterDue).toBe(0);
    for (const [k, bad] of [["REMINDER_FIRST_DAYS_AFTER_DUE", "29"], ["REMINDER_REPEAT_DAYS", "0"], ["REMINDER_MAX_PER_PAYMENT", "11"], ["REMINDER_MAX_PER_PAYMENT", "abc"]] as const)
      expect(problems({ ...valid, [k]: bad }).join(), `${k}=${bad}`).toMatch(new RegExp(k));
  });
});
