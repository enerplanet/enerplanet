// Shared i18n key-scanning logic for the i18n hygiene test (src/tests/i18nKeys.test.ts)
// and the prune command (scripts/i18n-prune.mjs). Keep consumers in sync by importing
// from here — never duplicate the extraction heuristics.
//
// Scope: the app is not just frontend/src. The @spatialhub/{auth,forms,ui} packages
// are aliased into the bundle from libs/<pkg>/src and use the same t() calls, and the
// backend emits event keys (model.running, model.completed, …) that the frontend
// renders. Both must count as "used" or a prune would delete live translations.

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

/** A valid translation key: dot-separated identifiers, no spaces/URLs/JSX. */
export const KEY_RE = /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z0-9_]+)+$/;
/** A dynamic prefix: `family.of.keys.` (or a partial like `landing.howItWorks.step`). */
export const PREFIX_RE = /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z0-9_]+)*\.?$/;

export const PLURAL_SUFFIXES = ["zero", "one", "two", "few", "many", "other", "plural"];

export function stripPlural(key) {
  for (const suffix of PLURAL_SUFFIXES) {
    const marker = `_${suffix}`;
    if (key.endsWith(marker)) return key.slice(0, -marker.length);
  }
  return key;
}

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", "coverage"]);
const UI_EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const TEXT_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|go|py|sql|html|tmpl|yaml|yml|json|toml|md|txt)$/;

/** Recursively collect UI source files, skipping dependency/build/vcs dirs. */
export function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith(".")) {
        walk(path.join(dir, entry.name), out);
      }
    } else if (UI_EXT.test(entry.name)) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

/** Every text file (not just UI code) under the dirs — used for literal presence. */
export function walkText(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith(".")) {
        walkText(path.join(dir, entry.name), out);
      }
    } else if (TEXT_EXT.test(entry.name)) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

/** UI source files whose translation usage counts (locale files and tests excluded). */
export function uiSourceFiles(...dirs) {
  return dirs
    .flatMap((dir) => walk(dir))
    .filter((f) => !f.includes("locales") && !f.includes(".test.") && !f.includes(".spec."));
}

/** Text used only for the "does this literal appear anywhere" check. */
export function referenceText(...dirs) {
  return dirs
    .flatMap((dir) => walkText(dir))
    .filter((f) => !f.includes("/locales/") && !f.includes(".test.") && !f.includes(".spec."));
}

/**
 * Scan UI code for statically-callable t("...") keys and derive the families of
 * keys looked up dynamically (t(`prefix.${x}`) and standalone templates that
 * build a key for a later t(var) call, e.g. `landing.showcase.${item.key}Title`).
 *
 * @param {...string} uiDirs directories with code bundled into the app
 * @returns {{ staticKeys: Set<string>, dynPrefixes: Set<string> }}
 */
export function scanSource(...uiDirs) {
  const files = uiSourceFiles(...uiDirs);
  const staticKeys = new Set();
  const dynPrefixes = new Set();

  const registerTemplate = (tpl) => {
    if (tpl.includes("${")) {
      const prefix = tpl.slice(0, tpl.indexOf("${"));
      if (PREFIX_RE.test(prefix) && prefix.includes(".")) dynPrefixes.add(prefix);
    } else if (KEY_RE.test(tpl)) {
      staticKeys.add(tpl);
    }
  };

  // t("literal.key") / t('literal.key')
  const quoted = /\bt\(\s*(['"])((?:\\.|(?!\1)[^\\])*)\1/g;
  // t(`literal` / `prefix.${x}`) and standalone templates building keys for a later t(var)
  const templates = [/\bt\(\s*`((?:\\.|[^`\\])*)`/g, /`([^`]*\$\{[^`]*?)`/g];

  for (const file of files) {
    const code = readFileSync(file, "utf8");
    let m;
    while ((m = quoted.exec(code))) {
      const key = m[2];
      if (KEY_RE.test(key)) staticKeys.add(key);
    }
    for (const tplRe of templates) {
      while ((m = tplRe.exec(code))) registerTemplate(m[1]);
    }
  }

  // `tooltips.*` is looked up as t(`${translationKey}.title`) from TOOLTIP_KEYS;
  // the full key never appears literally, so the family must be declared by hand.
  dynPrefixes.add("tooltips.");

  return { staticKeys, dynPrefixes };
}

export function loadLocales(localesDir) {
  return readdirSync(localesDir)
    .filter((f) => f.endsWith(".json"))
    .map((file) => {
      const json = JSON.parse(readFileSync(path.join(localesDir, file), "utf8"));
      return {
        file,
        path: path.join(localesDir, file),
        json,
        keys: new Set(flatten(json).map(stripPlural)),
      };
    });
}

export function flatten(obj, prefix = "", acc = []) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object") flatten(v, key, acc);
    else acc.push(key);
  }
  return acc;
}

/**
 * The directories that make up the app:
 * - uiDirs: frontend/src plus the @spatialhub packages aliased into the bundle
 * - textDirs: uiDirs plus backend/platform-core whose emitted keys the UI renders
 */
export function appDirs(frontendRoot) {
  const uiDirs = [
    path.join(frontendRoot, "src"),
    ...["auth", "forms", "ui"].map((lib) => path.resolve(frontendRoot, "../../libs", lib, "src")),
  ].filter((dir) => {
    try {
      return readdirSync(dir).length >= 0;
    } catch {
      return false;
    }
  });
  const textDirs = [
    ...uiDirs,
    path.resolve(frontendRoot, "../backend"),
    path.resolve(frontendRoot, "../../platform-core"),
  ].filter((dir) => {
    try {
      return readdirSync(dir).length >= 0;
    } catch {
      return false;
    }
  });
  return { uiDirs, textDirs };
}

/** One-shot scope for a frontend checkout: static keys, dynamic families, reference text. */
export function i18nScope(frontendRoot) {
  const { uiDirs, textDirs } = appDirs(frontendRoot);
  const { staticKeys, dynPrefixes } = scanSource(...uiDirs);
  const sourceText = referenceText(...textDirs).map((f) => readFileSync(f, "utf8")).join("\n");
  return { staticKeys, dynPrefixes, sourceText, uiDirs, textDirs };
}

/** Keys that count as used: static t() call, literal anywhere in the reference text, or dynamic family. */
export function usedKeySet(staticKeys, dynPrefixes, sourceText) {
  const dyn = [...dynPrefixes];
  return (key) =>
    staticKeys.has(key) || sourceText.includes(key) || dyn.some((p) => key.startsWith(p));
}

/** Unused keys of a locale, sorted. */
export function computeUnusedKeys(staticKeys, dynPrefixes, sourceText, localeKeys) {
  const isUsed = usedKeySet(staticKeys, dynPrefixes, sourceText);
  return [...localeKeys].sort().filter((key) => !isUsed(key));
}
