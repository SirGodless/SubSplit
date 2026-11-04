import { describe, expect, it } from "vitest";
import { formatDueDate, formatMonth, parseEuro } from "@/lib/format";

describe("format", () => {
  it("parseEuro", () => {
    expect(parseEuro("12,99")).toBe(1299);
    expect(parseEuro("12.5")).toBe(1250);
    expect(parseEuro(" 7 ")).toBe(700);
    expect(parseEuro("0,05")).toBe(5);
    for (const bad of ["", "abc", "1,234", "-3", "1e3", "12,"]) expect(parseEuro(bad), bad).toBeNull();
  });
  it("Monat und Fälligkeit", () => {
    expect(formatMonth("2026-11")).toBe("November 2026");
    expect(formatDueDate("2026-11", 1)).toBe("01.11.2026");
  });
});
