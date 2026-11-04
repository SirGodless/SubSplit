import { describe, expect, it } from "vitest";
import { buildEpcPayload, formatEpcAmount } from "@/lib/pay/epc";
import { buildPaymentLinks, buildRemittance } from "@/lib/pay/links";
import { buildPaypalLink, formatPaypalAmount } from "@/lib/pay/paypal";

describe("EPC / GiroCode", () => {
  it("feste Beispiel-Payload (EPC069-12, Version 002)", () => {
    const payload = buildEpcPayload({
      name: "Max Mustermann",
      iban: "DE89 3704 0044 0532 0130 00",
      amountCents: 1234,
      remittance: "K7M2QX SubSplit 2026-11",
    });
    expect(payload).toBe(
      ["BCD", "002", "1", "SCT", "", "Max Mustermann", "DE89370400440532013000", "EUR12.34", "", "", "K7M2QX SubSplit 2026-11"].join("\n"),
    );
  });
  it("Betragsformat", () => {
    expect(formatEpcAmount(5)).toBe("EUR0.05");
    expect(formatEpcAmount(100)).toBe("EUR1.00");
    expect(formatEpcAmount(123456)).toBe("EUR1234.56");
    expect(() => formatEpcAmount(0)).toThrow();
    expect(() => formatEpcAmount(10.5)).toThrow();
  });
  it("Limits: Name 70, Verwendungszweck 140 Zeichen; Zeilenumbrüche werden entfernt", () => {
    const base = { name: "A", iban: "DE89370400440532013000", amountCents: 100, remittance: "x" };
    expect(() => buildEpcPayload({ ...base, name: "a".repeat(71) })).toThrow();
    expect(() => buildEpcPayload({ ...base, remittance: "a".repeat(141) })).toThrow();
    expect(() => buildEpcPayload({ ...base, remittance: "a".repeat(140) })).not.toThrow();
    const p = buildEpcPayload({ ...base, name: "Max\nMuster" });
    expect(p.split("\n")).toHaveLength(11);
    expect(p.split("\n")[5]).toBe("Max Muster");
  });
});

describe("PayPal-Link (eine Stelle, konfigurierbar)", () => {
  it("Standardformat", () => {
    expect(buildPaypalLink("MaxMuster", 1234)).toBe("https://www.paypal.com/paypalme/MaxMuster/12.34EUR");
    expect(formatPaypalAmount(5)).toBe("0.05EUR");
  });
  it("Varianten über Konfiguration", () => {
    const f = { baseUrl: "https://paypal.me/", decimalSeparator: "," as const, appendCurrency: false, currency: "EUR" };
    expect(buildPaypalLink("MaxMuster", 1050, f)).toBe("https://paypal.me/MaxMuster/10,50");
  });
  it("lehnt ungültige Namen und Beträge ab (keine Parameter-Injektion)", () => {
    expect(() => buildPaypalLink("max/../x", 100)).toThrow();
    expect(() => buildPaypalLink("max?x=1", 100)).toThrow();
    expect(() => buildPaypalLink("MaxMuster", 0)).toThrow();
  });
});

describe("Zahlungslinks", () => {
  it("ein Satz pro Monatszahlung mit Verwendungszweck <ID> <App> <Monat>", async () => {
    expect(buildRemittance("K7M2QX", "SubSplit", "2026-11")).toBe("K7M2QX SubSplit 2026-11");
    const l = await buildPaymentLinks(
      { name: "Max Mustermann", paypalMe: "MaxMuster", iban: "DE89370400440532013000", appName: "SubSplit" },
      { referenceId: "K7M2QX", month: "2026-11", amountCents: 1234 },
    );
    expect(l.paypalUrl).toContain("/MaxMuster/12.34EUR");
    expect(l.paypalQrSvg).toMatch(/^<svg/);
    expect(l.giroCodeSvg).toMatch(/^<svg/);
    expect(l.remittance).toBe("K7M2QX SubSplit 2026-11");
  });
});
