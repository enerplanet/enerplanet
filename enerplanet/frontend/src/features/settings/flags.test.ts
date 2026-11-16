import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { FEATURE_FLAGS, sectionTitleKey, type FeatureFlagCategory } from "./flags";

/**
 * Feature-flag registry hygiene.
 *
 * The settings panel resolves a flag's label/description through variables
 * (`t(flag.labelKey)`), so `npm run i18n:check` cannot see those keys — its
 * scanner only reads static `t("literal")` calls. A flag whose keys are missing
 * from a locale would therefore fall back silently. This test closes that gap:
 * every flag's keys must exist and be non-empty in every locale file.
 */

const FRONTEND_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const LOCALES_DIR = path.join(FRONTEND_ROOT, "src", "locales");

function loadLocales(): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const file of readdirSync(LOCALES_DIR)) {
    if (!file.endsWith(".json")) continue;
    out[file.replace(/\.json$/, "")] = JSON.parse(
      readFileSync(path.join(LOCALES_DIR, file), "utf8"),
    );
  }
  return out;
}

/** Value of a flattened dotted key inside a nested locale object. */
function localeValue(
  json: Record<string, unknown>,
  dotted: string,
): string | undefined {
  let node: unknown = json;
  for (const part of dotted.split(".")) {
    if (!node || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string" ? node : undefined;
}

const locales = loadLocales();

describe("feature flag registry", () => {
  it("has at least one flag", () => {
    expect(FEATURE_FLAGS.length).toBeGreaterThan(0);
  });

  it("uses unique, non-empty ids", () => {
    const ids = FEATURE_FLAGS.map((flag) => flag.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id.trim()).not.toBe("");
  });

  it("declares keyed label/description and a boolean default", () => {
    for (const flag of FEATURE_FLAGS) {
      expect(flag.labelKey).toMatch(/^settings\.featureFlags\.flags\./);
      expect(flag.descriptionKey).toMatch(/^settings\.featureFlags\.flags\./);
      expect(typeof flag.default).toBe("boolean");
      expect(["general", "experimental"]).toContain(flag.category);
    }
  });

  it("resolves every flag's label and description in every locale", () => {
    const missing: string[] = [];
    for (const [locale, json] of Object.entries(locales)) {
      for (const flag of FEATURE_FLAGS) {
        for (const key of [flag.labelKey, flag.descriptionKey]) {
          const value = localeValue(json, key);
          if (!value || value.trim() === "") missing.push(`${locale}: ${key}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it("resolves the panel's own keys (warning banner, empty state) in every locale", () => {
    const keys = [
      "settings.featureFlags.warning.title",
      "settings.featureFlags.warning.description",
      "settings.featureFlags.empty",
    ];
    const missing: string[] = [];
    for (const [locale, json] of Object.entries(locales)) {
      for (const key of keys) {
        const value = localeValue(json, key);
        if (!value || value.trim() === "") missing.push(`${locale}: ${key}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("resolves a heading for every section rendered with one (all but the first)", () => {
    // The panel groups flags by category in registry order and draws a heading
    // for every group after the first — mirror that order here.
    const orderedCategories: FeatureFlagCategory[] = [];
    for (const flag of FEATURE_FLAGS) {
      if (!orderedCategories.includes(flag.category)) orderedCategories.push(flag.category);
    }
    const keys = orderedCategories.slice(1).map(sectionTitleKey);
    const missing: string[] = [];
    for (const [locale, json] of Object.entries(locales)) {
      for (const key of keys) {
        const value = localeValue(json, key);
        if (!value || value.trim() === "") missing.push(`${locale}: ${key}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
