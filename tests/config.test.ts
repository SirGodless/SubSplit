import { describe, expect, it } from "vitest";
import { ConfigError, isValidCidr, loadConfig } from "@/lib/config";
import { isValidIban } from "@/lib/config/iban";

const valid = {
  BASE_URL: "https://abos.example.org/",
  ADMIN_PASSWORD_HASH: "scrypt:16384:8:1:c2FsdA:aGFzaA",
  SESSION_SECRET: "x".repeat(32),
  RECIPIENT_NAME: "Max Mustermann",
  RECIPIENT_PAYPAL_ME: "MaxMuster",
  RECIPIENT_IBAN: "DE89 3704 0044 0532 0130 00",
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
    expect(c.recipientIban).toBe("DE89370400440532013000");
    expect(c.dueDay).toBe(1);
    expect(c.securityLogFile).toBe("/logs/security.log");
    expect(c.trustedProxyCidrs).toEqual([]);
    expect(c.appName).toBe("SubSplit");
  });
  it("sammelt alle Fehler auf einmal", () => {
    expect(problems({}).length).toBeGreaterThanOrEqual(5);
  });
  it("bricht bei ungültiger IBAN ab", () => {
    expect(problems({ ...valid, RECIPIENT_IBAN: "DE89370400440532013001" }).join()).toMatch(/RECIPIENT_IBAN/);
  });
  it("bricht bei unerlaubten PayPal-Zeichen ab", () => {
    for (const bad of ["max/muster", "paypal.me/max", "max muster", "max?x=1", "a".repeat(21)]) {
      expect(problems({ ...valid, RECIPIENT_PAYPAL_ME: bad }).join(), bad).toMatch(/RECIPIENT_PAYPAL_ME/);
    }
  });
  it("prüft DUE_DAY, SESSION_SECRET, BASE_URL", () => {
    expect(problems({ ...valid, DUE_DAY: "0" }).join()).toMatch(/DUE_DAY/);
    expect(problems({ ...valid, DUE_DAY: "29" }).join()).toMatch(/DUE_DAY/);
    expect(loadConfig({ ...valid, DUE_DAY: "15" }).dueDay).toBe(15);
    expect(problems({ ...valid, SESSION_SECRET: "kurz" }).join()).toMatch(/SESSION_SECRET/);
    expect(problems({ ...valid, BASE_URL: "ftp://x" }).join()).toMatch(/BASE_URL/);
  });
  it("gibt Secrets nie in Fehlermeldungen aus", () => {
    const msg = problems({ ...valid, SESSION_SECRET: "geheim" }).join();
    expect(msg).not.toContain("geheim");
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
    expect(loadConfig(valid).paypalFormat).toEqual({ baseUrl: "https://www.paypal.com/paypalme", decimalSeparator: ".", appendCurrency: false, currency: "EUR" });
    const c = loadConfig({ ...valid, PAYPAL_LINK_BASE: "https://paypal.me/", PAYPAL_APPEND_CURRENCY: "true", PAYPAL_DECIMAL: "comma" });
    expect(c.paypalFormat).toEqual({ baseUrl: "https://paypal.me", decimalSeparator: ",", appendCurrency: true, currency: "EUR" });
  });
  it("lehnt fremde Hosts, http, Parameter und unbekannte Werte ab", () => {
    for (const bad of ["https://evil.example/paypalme", "http://paypal.com/paypalme", "https://paypal.com.evil.example/x", "https://paypal.me/?a=1", "paypal.me"]) {
      expect(problems({ ...valid, PAYPAL_LINK_BASE: bad }).join(), bad).toMatch(/PAYPAL_LINK_BASE/);
    }
    expect(problems({ ...valid, PAYPAL_DECIMAL: "x" }).join()).toMatch(/PAYPAL_DECIMAL/);
    expect(problems({ ...valid, PAYPAL_APPEND_CURRENCY: "vielleicht" }).join()).toMatch(/PAYPAL_APPEND_CURRENCY/);
  });
});
