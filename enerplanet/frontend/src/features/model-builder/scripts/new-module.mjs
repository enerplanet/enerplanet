#!/usr/bin/env node
/**
 * Scaffold a module from the example.
 *
 *   node src/features/model-builder/scripts/new-module.mjs tariff-settings "Tariff settings"
 *
 * Copies `modules/example/` into `modules/<id>/` as a workspace of its own — its own package.json,
 * tsconfig, vitest config and install — rewrites the id, the label and the i18n key prefix, registers
 * the entry in `shell/moduleRegistry.ts`, and prints what is left for you.
 *
 * The copy is a *starting point*, not a finished module: it still asserts the example's specifics, so
 * the first thing to do is make its test say something true about your module.
 */

import { existsSync } from "node:fs";
import { cp, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const feature = resolve(here, "..");
const templateDir = join(feature, "modules", "example");

const [id, label] = process.argv.slice(2);

if (id === undefined || !/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(id)) {
  console.error("usage: new-module.mjs <id> [label]    id: lowercase words, dash-separated");
  process.exit(1);
}
if (id === "example") {
  console.error('"example" is the template — pick a different id');
  process.exit(1);
}

const targetDir = join(feature, "modules", id);
if (existsSync(targetDir)) {
  console.error(`${targetDir} already exists — nothing written`);
  process.exit(1);
}

const name = label ?? id;
const camel = id.replace(/-([a-z0-9])/g, (_, character) => character.toUpperCase());

/**
 * Order matters: the quoted id goes first, so the identifier rename below cannot reach inside a string,
 * and the i18n prefix is rewritten before the bare `example` identifier is.
 */
function rewrite(source) {
  return source
    .replaceAll("@model-builder/example", `@model-builder/${id}`)
    .replaceAll("modelBuilder.example.", `modelBuilder.${id}.`)
    .replaceAll('"example"', `"${id}"`)
    .replaceAll("Example module", `${name}`)
    .replaceAll("example module", `${id} module`)
    .replaceAll("example-layer", `${id}-layer`)
    .replace(/\bexample\b/g, camel);
}

// The template's install and lock belong to the template, not to the copy.
const skip = new Set(["node_modules", "package-lock.json", ".git"]);

await cp(templateDir, targetDir, {
  recursive: true,
  filter: (source) => !skip.has(source.split("/").pop()),
});

for (const file of ["index.tsx", "index.test.ts", "package.json"]) {
  const path = join(targetDir, file);
  await writeFile(path, rewrite(await readFile(path, "utf8")));
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

console.log(`created modules/${id}/ and registered it as "${camel}"\n`);
console.log("next:");
console.log(`  1. cd modules/${id} && npm install && npm test     # it is its own workspace`);
console.log(`  2. fix the copied test — it still asserts the example's specifics`);
console.log(`  3. add the locale keys under "${prefix}" to src/locales/{en,de,es,nl}.json`);
console.log(`  4. npm run verify in the module, then from frontend/ the feature suite, tsc and i18n:check`);
console.log(`  5. open /app/modelbuilder with the "modelbuilder" flag on and pick "${id}" in the dev picker`);
