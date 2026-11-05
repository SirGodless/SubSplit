import { describe, expect, it } from "vitest";
import { safeNextPath } from "@/lib/nav";

describe("safeNextPath", () => {
  it("erlaubt Pfade in der App", () => {
    expect(safeNextPath("/pay/3")).toBe("/pay/3");
    expect(safeNextPath("/pay/3?month=2026-11")).toBe("/pay/3?month=2026-11");
    expect(safeNextPath("/")).toBe("/");
  });
  it("lehnt fremde Ziele und Tricks ab", () => {
    for (const bad of ["//evil.example", "https://evil.example", "http://x", "/\\evil.example", "/pay/\r\nSet-Cookie: x", "javascript:alert(1)", "evil", "", "/login", "/login?next=/", " /pay/3", "/pay/3\t"]) {
      expect(safeNextPath(bad), bad).toBeNull();
    }
    expect(safeNextPath(undefined)).toBeNull();
    expect(safeNextPath(42)).toBeNull();
    expect(safeNextPath("/" + "a".repeat(300))).toBeNull();
  });
});
