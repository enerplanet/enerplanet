import {
  extractYearlyDemandFromProps as extractYearlyDemandFromFeatureProps,
} from "@/features/configurator/utils/buildingFeatureExtraction";

/**
 * Parses a flexible number string supporting European and US formats:
 * - "1,234.56" (US)
 * - "1.234,56" (European)
 * - "1 234,56" (French/whitespace separators)
 */
export const parseFlexibleNumberString = (input: string): number | null => {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const compact = trimmed.replace(/[\s\u00A0\u202F]/g, "");

  // 1,234.56
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(compact)) {
    const parsed = Number(compact.replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }

  // 1.234,56
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(compact)) {
    const parsed = Number(compact.replace(/\./g, "").replace(",", "."));
    return Number.isFinite(parsed) ? parsed : null;
  }

  const normalized =
    compact.includes(",") && !compact.includes(".") ? compact.replace(",", ".") : compact;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};

/** Coerces a number or numeric string into a finite number, else null. */
export const toFiniteNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    return parseFlexibleNumberString(value);
  }
  return null;
};

/** Parses a JSON-serialized tech map (string or object) into a plain record. */
export const parseTechs = (value: unknown): Record<string, unknown> => {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
};

/** Yearly demand with custom-only fallback (used by the area select UI). */
export const extractYearlyDemandCustomOnly = (props: Record<string, unknown>): number =>
  extractYearlyDemandFromFeatureProps(props, { demandEnergyFallback: "custom_only" });

/** Yearly demand with full fallback (used by layer building logic). */
export const extractYearlyDemandAll = (props: Record<string, unknown>): number =>
  extractYearlyDemandFromFeatureProps(props, { demandEnergyFallback: "all" });
