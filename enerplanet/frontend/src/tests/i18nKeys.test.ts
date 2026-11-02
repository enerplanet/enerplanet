import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "vitest";
import { computeUnusedKeys, i18nScope, loadLocales } from "../../scripts/i18n-scan.mjs";
import type { LocaleData } from "../../scripts/i18n-scan.mjs";

/**
 * i18n key hygiene test.
 *
 * Scans the source for statically-callable `t("...")` keys and compares them
 * with every locale file under src/locales/.
 *
 * - FAILS on keys used in code but missing from a language file. The failure
 *   message lists the keys as JSON text so they can be pasted straight into
 *   the locale files.
 * - WARNS (does not fail) on keys that exist in the locale files but are
 *   referenced nowhere in the source — pruning candidates. Run
 *   `npm run i18n:prune` (preview: `npm run i18n:prune -- --dry-run`) to
 *   remove them.
 *
 * The scanning logic lives in scripts/i18n-scan.mjs and is shared with the
 * prune command, so the warning and the cleaner can never disagree.
 *
 * Known limitation: keys looked up through variables/maps
 * (`t(parameterNameKeys[paramKey])`, `t(\`prefix.${x}\`)`, TOOLTIP_KEYS, …)
 * cannot be verified statically. For those we derive the dynamic key families
 * from template literals and exempt them from the unused report. The planned
 * key registry (src/locales/i18n-keys.ts) is the proper fix that would make
 * even those keys statically verifiable.
 */

const FRONTEND_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SRC_DIR = path.join(FRONTEND_ROOT, "src");
const LOCALES_DIR = path.join(SRC_DIR, "locales");

/** Value of a flattened dotted key inside a nested locale JSON. */
function localeValue(json: Record<string, unknown>, dotted: string): string {
  let node: unknown = json;
  for (const part of dotted.split(".")) {
    if (!node || typeof node !== "object") return "";
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string" ? node : "";
}

function renderMissingReport(missingByLocale: Map<string, string[]>, locales: LocaleData[]): string {
  const en = locales.find((l) => l.file === "en.json");
  const enMissing = missingByLocale.get("en.json") ?? [];
  const lines: string[] = [];

  lines.push(`i18n: ${[...missingByLocale.values()].reduce((n, ks) => n + ks.length, 0)} statically-used keys are missing from the language files.`);
  lines.push("");

  if (enMissing.length > 0) {
    lines.push(`Missing from EVERY locale file — add to all ${locales.length} files (currently show up as raw keys in the UI):`);
    for (const key of enMissing) lines.push(`  "${key}": ""`);
    lines.push("");
  }

  for (const [file, missing] of missingByLocale) {
    if (file === "en.json") continue;
    const onlyHere = missing.filter((k) => !enMissing.includes(k));
    if (onlyHere.length === 0) continue;
    lines.push(`Missing only in ${file} (${onlyHere.length}) — copy the English value: `);
    for (const key of onlyHere) {
      lines.push(`  "${key}": "${localeValue(en?.json ?? {}, key)}"`);
    }
    lines.push("");
  }

  for (const [file, missing] of missingByLocale) {
    lines.push(`${file}: ${missing.length} missing`);
  }
  return lines.join("\n");
}

describe("i18n key hygiene", () => {
  const { staticKeys, dynPrefixes, sourceText } = i18nScope(FRONTEND_ROOT);
  const locales = loadLocales(LOCALES_DIR);

  it("fails when a key used in the code is missing from a language file", () => {
    const missingByLocale = new Map<string, string[]>();
    for (const locale of locales) {
      const missing = [...staticKeys].filter((k) => !locale.keys.has(k)).sort();
      if (missing.length > 0) missingByLocale.set(locale.file, missing);
    }
    if (missingByLocale.size > 0) {
      throw new Error(renderMissingReport(missingByLocale, locales));
    }
  });

  it("warns (not fails) for keys that nothing in the app references anymore", () => {
    const en = locales.find((l) => l.file === "en.json");
    const unused = computeUnusedKeys(staticKeys, dynPrefixes, sourceText, en?.keys ?? new Set());

    if (unused.length > 0) {
      const hint = dynPrefixes.size > 0
        ? `\n(Keys under dynamic families are exempt: ${[...dynPrefixes].sort().join(", ")})`
        : "";
      console.warn(
        `[i18n] ${unused.length} unused key(s) in the locale files — candidates for pruning ` +
          `(remove them with \`npm run i18n:prune\`):${hint}\n` +
          unused.map((k) => `  ${k}`).join("\n")
      );
    }
  });
});
