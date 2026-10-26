import { i18n } from "@spatialhub/i18n";

const formats = new Map<string, Intl.NumberFormat>();

function cached(style: "decimal" | "currency", maxDigits: number, minDigits: number): Intl.NumberFormat {
  const lang = i18n.language?.split("-")[0] || "en";
  const key = `${lang}:${style}:${minDigits}:${maxDigits}`;
  let format = formats.get(key);
  if (!format) {
    format = new Intl.NumberFormat(lang, {
      ...(style === "currency" ? { style, currency: "EUR" } : {}),
      minimumFractionDigits: minDigits,
      maximumFractionDigits: maxDigits,
    });
    formats.set(key, format);
  }
  return format;
}

/** A number as the app language writes it: its decimal and thousands separators, with minDigits to maxDigits decimals. */
export function formatNumber(value: number, maxDigits = 0, minDigits = maxDigits): string {
  return cached("decimal", maxDigits, minDigits).format(value);
}

/** An amount in euros as the app language writes it, symbol placement included. */
export function formatCurrency(value: number, maxDigits = 2, minDigits = maxDigits): string {
  return cached("currency", maxDigits, minDigits).format(value);
}
