#!/usr/bin/env node
/**
 * Scaffold a module from one of the example templates.
 *
 *   node src/features/model-builder/scripts/new-module.mjs tariff-settings interactive "Tariff settings"
 *   node src/features/model-builder/scripts/new-module.mjs area-summary auto
 *
 * Copies `modules/examples/<type>/` into `modules/<id>/` as a workspace of its own — its own package.json,
 * tsconfig, vitest config and install — rewrites the declared id, the name and the i18n key prefix, registers
 * the entry in `shell/moduleRegistry.ts`, and prints what is left for you.
 */

import { existsSync } from "node:fs";
import { cp, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const feature = resolve(here, "..");

/** The two templates, keyed by the type the user names. */
const TEMPLATES = {
  interactive: {
    dir: join("modules", "examples", "interactive"),
    id: "example-interactive",
    camel: "exampleInteractive",
    name: "Example interactive module",
    literals: [
      ["example-area", "-area"],
      ["example-name", "-name"],
      ["example-resolution", "-resolution"],
    ],
  },
  auto: {
    dir: join("modules", "examples", "auto"),
    id: "example-auto",
    camel: "exampleAuto",
    name: "Example auto module",
    // Nothing to rewrite: every trace of this template's name is its declared id or prose about it.
    literals: [],
  },
};

const TYPES = Object.keys(TEMPLATES);

/** Names a new module may not take: the templates' own declared ids, and the folder that holds the templates. */
const RESERVED = new Set(["examples", TEMPLATES.interactive.id, TEMPLATES.auto.id]);

const [id, type, label] = process.argv.slice(2);

const usage = `usage: new-module.mjs <id> <type> [label]    id: lowercase words, dash-separated    type: ${TYPES.join(" | ")}`;

if (id === undefined || !/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(id)) {
  console.error(usage);
  process.exit(1);
}
if (type === undefined || !TYPES.includes(type)) {
  console.error(usage);
  process.exit(1);
}
if (RESERVED.has(id)) {
  console.error(`"${id}" is reserved (a template's own id, or the folder holding them) — pick a different id`);
  process.exit(1);
}

const targetDir = join(feature, "modules", id);
if (existsSync(targetDir)) {
  console.error(`${targetDir} already exists — nothing written`);
  process.exit(1);
}

const template = TEMPLATES[type];
const templateDir = join(feature, template.dir);

const name = label ?? id;
const camel = id.replace(/-([a-z0-9])/g, (_, character) => character.toUpperCase());

/** Escape a literal string for use inside a `RegExp`. */
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The ordered replacement pass — from the template's declared id, identifier and name to the new module's.
 */
function rulesFor(from, to) {
  return [
    { name: "package", from: `@model-builder/${from.id}`, to: `@model-builder/${to.id}` },
    { name: "i18n-prefix", from: `modelBuilder.${from.id}.`, to: `modelBuilder.${to.id}.` },
    { name: "id-literal", from: `"${from.id}"`, to: `"${to.id}"` },
    { name: "name", from: from.name, to: to.name },
    { name: "module-phrase", from: "example module", to: `${to.id} module` },
    ...from.literals.map(([literal, suffix]) => ({
      name: `template-literal:${literal}`,
      from: literal,
      to: `${to.id}${suffix}`,
    })),
    { name: "identifier", from: new RegExp(`\\b${escapeRegExp(from.camel)}\\b`, "g"), to: to.camel },
    { name: "bare-id", from: new RegExp(`\\b${escapeRegExp(from.id)}\\b`, "g"), to: to.id },
  ];
}

/**
 * Apply the rules in order, tallying what each one changed; returns the rewritten text and the rules that fired.
 */
function applyRewrite(source, rules) {
  let text = source;
  const fired = [];
  for (const rule of rules) {
    let count = 0;
    if (typeof rule.from === "string") {
      const parts = text.split(rule.from);
      count = parts.length - 1;
      if (count > 0) text = parts.join(rule.to);
    } else {
      text = text.replace(rule.from, () => {
        count += 1;
        return rule.to;
      });
    }
    if (count > 0) fired.push({ name: rule.name, count });
  }
  return { text, fired };
}

// The template's install and lock belong to the template, not to the copy.
const COPY_SKIP = new Set(["node_modules", "package-lock.json", ".git"]);
const WALK_SKIP_DIRS = new Set(["node_modules", ".git"]);
const WALK_SKIP_FILES = new Set(["package-lock.json", ".gitignore"]);
const REWRITE_EXTENSION = /\.(ts|tsx|json)$/;

/** Every rewriteable file under `dir`, walking the whole copied tree. */
async function rewriteableFiles(dir) {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!WALK_SKIP_DIRS.has(entry.name)) found.push(...(await rewriteableFiles(path)));
    } else if (!WALK_SKIP_FILES.has(entry.name) && REWRITE_EXTENSION.test(entry.name)) {
      found.push(path);
    }
  }
  return found;
}

await cp(templateDir, targetDir, {
  recursive: true,
  filter: (source) => !COPY_SKIP.has(source.split("/").pop()),
});

const rules = rulesFor(template, { id, camel, name });

const report = [];
for (const path of await rewriteableFiles(targetDir)) {
  const { text, fired } = applyRewrite(await readFile(path, "utf8"), rules);
  const total = fired.reduce((sum, rule) => sum + rule.count, 0);
  if (total > 0) await writeFile(path, text);
  report.push({ file: relative(targetDir, path), total, fired });
}

const registryPath = join(feature, "shell", "moduleRegistry.ts");
const registry = await readFile(registryPath, "utf8");

if (!registry.includes(`../modules/${id}`)) {
  const withImport = registry.replace(
    /^export const MODULES/m,
    `import ${camel} from "../modules/${id}";\n\nexport const MODULES`,
  );
  const withEntry = withImport.replace(/^\];/m, `  ${camel},\n];`);
  if (withImport === registry || withEntry === withImport) {
    console.error("could not splice the registry automatically — add the import and the entry by hand");
    process.exit(1);
  }
  await writeFile(registryPath, withEntry);
}

const prefix = `modelBuilder.${id}`;

console.log(`created modules/${id}/ from the ${type} template, and registered it as "${camel}"\n`);

console.log("rewrite:");
for (const { file, total, fired } of report) {
  const rules = fired.length > 0 ? fired.map((rule) => `${rule.name}=${rule.count}`).join(", ") : "no matches";
  console.log(`  ${file}: ${total} replacement${total === 1 ? "" : "s"} — ${rules}`);
}
console.log();

console.log("next:");
console.log("  1. npm install (at frontend/) — the modules are npm workspaces, so that covers yours");
console.log(`     then: cd modules/${id} && npm test`);
console.log(`  2. fix the copied test — it still asserts the ${type} template's specifics`);
console.log(`  3. add the locale keys under "${prefix}" to src/locales/{en,de,es,nl}.json`);
console.log("  4. npm run verify in the module, then from frontend/ the feature suite, tsc and i18n:check");
console.log(`  5. open /app/modelbuilder with the "modelbuilder" flag on, and pick "${id}" in the bar's dev mode select`);
console.log();
console.log("land it — a module lives in this repository, so it lands by pull request:");
console.log(`  git switch -c add-${id}`);
console.log(
  `  git add src/features/model-builder/modules/${id} src/features/model-builder/shell/moduleRegistry.ts src/locales/{en,de,es,nl}.json`,
);
console.log(`  git commit -m "Add the ${id} module"`);
console.log(`  git push -u origin add-${id}`);
console.log("  open a pull request against enerplanet/enerplanet");
