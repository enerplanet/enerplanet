#!/usr/bin/env node
// Remove unused translation keys from every src/locales/*.json file.
//
// "Unused" matches the i18n hygiene test (src/tests/i18nKeys.test.ts): a key is
// used when it is referenced by a static t() call, appears literally anywhere in
// src/ (map values, ternaries, constants feeding t(var)), or belongs to a
// dynamically-looked-up family. See scripts/i18n-scan.mjs.
//
// Usage:
//   npm run i18n:prune              # remove and rewrite the locale files
//   npm run i18n:prune -- --dry-run # preview only, write nothing

import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { i18nScope, loadLocales, computeUnusedKeys, stripPlural } from "./i18n-scan.mjs";

const FRONTEND_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LOCALES_DIR = path.join(FRONTEND_ROOT, "src", "locales");

const dryRun = process.argv.includes("--dry-run");

const { staticKeys, dynPrefixes, sourceText } = i18nScope(FRONTEND_ROOT);
const locales = loadLocales(LOCALES_DIR);

/** Drop leaves whose (plural-stripped) dotted key is unused; prune empty parents. */
function pruneObject(obj, isUnused, prefix = "") {
  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object") {
      const sub = pruneObject(value, isUnused, full);
      if (Object.keys(sub).length > 0) result[key] = sub;
    } else if (!isUnused(stripPlural(full))) {
      result[key] = value;
    }
  }
  return result;
}

let totalRemoved = 0;
const rows = [];

for (const locale of locales) {
  const unused = computeUnusedKeys(staticKeys, dynPrefixes, sourceText, locale.keys);
  if (unused.length === 0) {
    rows.push({ file: locale.file, removed: 0, first: [] });
    continue;
  }
  const isUnused = new Set(unused);
  const pruned = pruneObject(locale.json, (key) => isUnused.has(key));
  totalRemoved += unused.length;
  rows.push({ file: locale.file, removed: unused.length, first: unused.slice(0, 5) });

  if (!dryRun) {
    writeFileSync(locale.path, `${JSON.stringify(pruned, null, 2)}\n`);
  }
}

const width = Math.max(...rows.map((r) => r.file.length));
console.log(`${dryRun ? "[dry-run] would remove" : "Removed"} unused translation keys:`);
for (const { file, removed, first } of rows) {
  const sample = removed > 0 ? `  e.g. ${first.join(", ")}${removed > 5 ? ", …" : ""}` : "";
  console.log(`  ${file.padEnd(width)}  ${removed}${sample}`);
}
console.log(`Total: ${totalRemoved} unused key${totalRemoved === 1 ? "" : "s"}`);

if (!dryRun && totalRemoved > 0) {
  console.log("\nReview with `git diff src/locales`, then re-run `npm run i18n:check`.");
}
