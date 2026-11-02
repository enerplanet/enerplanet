import { afterEach, describe, expect, it } from "vitest";
import { i18n } from "@spatialhub/i18n";
import { formatCurrency, formatNumber } from "./formatNumber";

describe("formatNumber", () => {
  const original = i18n.language;
  afterEach(() => {
    i18n.language = original;
  });

  it("uses the app language's separators", () => {
    i18n.language = "en";
    expect(formatNumber(1234.5, 1)).toBe("1,234.5");
    i18n.language = "de-DE";
    expect(formatNumber(1234.5, 1)).toBe("1.234,5");
  });

  it("pads to minDigits and rounds to maxDigits", () => {
    i18n.language = "en";
    expect(formatNumber(2, 2)).toBe("2.00");
    expect(formatNumber(2.456, 2, 0)).toBe("2.46");
    expect(formatNumber(2, 2, 0)).toBe("2");
  });

  it("writes euros the way the app language does", () => {
    i18n.language = "en";
    expect(formatCurrency(1234.5)).toBe("€1,234.50");
    i18n.language = "de";
    expect(formatCurrency(1234.5, 0).replace(/\s/g, " ")).toBe("1.235 €");
  });
});
