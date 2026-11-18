/**
 * The scaffold script, exercised for real.
 *
 * The script copies a template, rewrites it and splices `shell/moduleRegistry.ts` — the file writing and the
 * registry splice are the risky parts, so these cases run the script **as a subprocess**, not by importing its
 * helpers. To make that safe, each case builds a throwaway checkout in the OS temp dir that mirrors the paths
 * the script resolves from its own location (`<root>/scripts/…`, `<root>/modules/examples/…`,
 * `<root>/shell/moduleRegistry.ts`) and runs the script *there*. The script then reads and writes only inside
 * that copy, so the real tree cannot be touched — which the last case proves by re-hashing the real registry
 * and checking the real `modules/` for anything the runs could have created.
 */
import { describe, it, expect, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_FILE = "new-module.mjs";
const REGISTRY_FILE = "moduleRegistry.ts";

// The two types, and the module ids the cases use — named once so the literal is not repeated everywhere.
const INTERACTIVE = "interactive";
const AUTO = "auto";
const TARIFF = "tariff-settings";
const AREA = "area-summary";
const DASHBOARD = "dashboard";

// A template's own declared id, which a new module may never take.
const EXAMPLE_ID = "example-interactive";
const TEMPLATE_ID = "example-auto";

const here = dirname(fileURLToPath(import.meta.url));
const featureDir = resolve(here, "..");
const scriptPath = join(here, SCRIPT_FILE);
const templatesDir = join(featureDir, "modules", "examples");
const registryPath = join(featureDir, "shell", REGISTRY_FILE);

const DEP_CORE = "file:../../core";
const DEP_I18N = "file:../../../../../../../libs/i18n";

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/** The real registry's hash before any case runs — the baseline the last case re-checks. */
const registryHashBefore = sha256(registryPath);

const created: string[] = [];

afterAll(() => {
  for (const root of created) rmSync(root, { recursive: true, force: true });
});

/** A throwaway checkout shaped the way the script expects, so a run writes only inside it. */
function sandbox(): string {
  const root = mkdtempSync(join(tmpdir(), "new-module-test-"));
  created.push(root);
  mkdirSync(join(root, "scripts"), { recursive: true });
  mkdirSync(join(root, "shell"), { recursive: true });
  mkdirSync(join(root, "modules", "examples"), { recursive: true });
  cpSync(scriptPath, join(root, "scripts", SCRIPT_FILE));
  cpSync(registryPath, join(root, "shell", REGISTRY_FILE));
  for (const type of [INTERACTIVE, AUTO]) {
    cpSync(join(templatesDir, type), join(root, "modules", "examples", type), {
      recursive: true,
      filter: (source) => !source.split(/[/\\]/).includes("node_modules"),
    });
  }
  return root;
}

interface Run {
  status: number;
  stdout: string;
  stderr: string;
}

/** Run the script inside `root` and capture its exit code and output, whatever it is. */
function run(root: string, args: string[]): Run {
  try {
    const stdout = execFileSync(process.execPath, [join(root, "scripts", SCRIPT_FILE), ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: 0, stdout, stderr: "" };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return { status: failure.status ?? -1, stdout: failure.stdout ?? "", stderr: failure.stderr ?? "" };
  }
}

/** Read a file inside a created module directory. */
function moduleFile(root: string, id: string, file: string): string {
  return readFileSync(join(root, "modules", id, file), "utf8");
}

function registryOf(root: string): string {
  return readFileSync(join(root, "shell", REGISTRY_FILE), "utf8");
}

interface Manifest {
  name: string;
  dependencies: Record<string, string>;
}

describe("the scaffold script", () => {
  it("copies the interactive template, rewrites it, and registers it", () => {
    const root = sandbox();
    const result = run(root, [TARIFF, INTERACTIVE, "Tariff settings"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`from the ${INTERACTIVE} template`);
    expect(result.stdout).toContain('registered it as "tariffSettings"');

    // The copy is a workspace of its own, with the id as its package name.
    const manifest = JSON.parse(moduleFile(root, TARIFF, "package.json")) as Manifest;
    expect(manifest.name).toBe(`@model-builder/${TARIFF}`);

    // The `file:` dependency paths are deliberately correct for where the copy lands and must be left alone.
    expect(manifest.dependencies["@model-builder/core"]).toBe(DEP_CORE);
    expect(manifest.dependencies["@spatialhub/i18n"]).toBe(DEP_I18N);

    // The declared id, the name and the i18n prefix are rewritten; the declared id does not survive. The bare
    // word "example" in the copied prose is *not* rewritten — that is the dedicated case below.
    const index = moduleFile(root, TARIFF, "index.tsx");
    expect(index).toContain(`id: "${TARIFF}"`);
    expect(index).toContain('name: "Tariff settings"');
    expect(index).toContain(`modelBuilder.${TARIFF}.`);
    expect(index).not.toContain(EXAMPLE_ID);

    // The registry gains the import and the entry, off the new camelCase identifier.
    const registry = registryOf(root);
    expect(registry).toContain(`import tariffSettings from "../modules/${TARIFF}";`);
    expect(registry).toContain("  tariffSettings,");
  });

  it("copies the auto template and rewrites every language file, not a fixed three", () => {
    const root = sandbox();
    const result = run(root, [AREA, AUTO]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`from the ${AUTO} template`);
    expect(result.stdout).toContain('registered it as "areaSummary"');

    const manifest = JSON.parse(moduleFile(root, AREA, "package.json")) as Manifest;
    expect(manifest.name).toBe(`@model-builder/${AREA}`);
    expect(manifest.dependencies["@model-builder/core"]).toBe(DEP_CORE);
    expect(manifest.dependencies["@spatialhub/i18n"]).toBe(DEP_I18N);

    // `overlay.test.tsx` — a file the interactive template does not have — is rewritten.
    const overlay = moduleFile(root, AREA, "overlay.test.tsx");
    expect(overlay).toContain(`nodeId="${AREA}"`);
    expect(overlay).toContain("areaSummary.Component");
    expect(overlay).toContain(`modelBuilder.${AREA}.failed`);
    expect(overlay).not.toContain(TEMPLATE_ID);
    expect(overlay).not.toContain("exampleAuto");

    // `source.ts` likewise — id and prose rewritten, the core import left alone.
    const source = moduleFile(root, AREA, "source.ts");
    expect(source).not.toContain(TEMPLATE_ID);
    expect(source).toContain('from "@model-builder/core"');

    // The namespaced key and the module's id both key off the declared id.
    const index = moduleFile(root, AREA, "index.tsx");
    expect(index).toContain(`id: "${AREA}"`);
    expect(index).toContain(`AREA_SUMMARY_KEY = "${AREA}.areaSummary"`);
    // The template's declared id is gone. The bare *word* "example" in its prose is not, on purpose — those
    // comments describe the template the reader is looking at (see the next case).
    expect(index).not.toContain(TEMPLATE_ID);

    // The two workspace config files are walked but carry none of the template's ids.
    expect(result.stdout).toContain("vitest.config.ts: 0 replacements");
    expect(result.stdout).toContain("tsconfig.json: 0 replacements");

    // The report names the rule that fired for a rewritten file.
    expect(result.stdout).toContain("source.ts:");
    expect(result.stdout).toMatch(/index\.tsx: \d+ replacements.*i18n-prefix=/);
  });

  it('leaves the template\'s prose intact — the word "example" is a word, not an identifier', () => {
    const root = sandbox();
    run(root, [AREA, AUTO, "Area summary"]);

    // The rewrite pass is deliberately blunt, so what it must NOT do is worth pinning. A rule mapping the bare
    // word onto the identifier would rewrite these comments into the new module's own name; the auto template's
    // identifier is `exampleAuto`, so such a rule could only ever reach prose like this. Comments that still
    // describe the template are worth more to the person editing the copy than a uniformly renamed word.
    const source = moduleFile(root, AREA, "source.ts");

    expect(source).toContain("This example ships a working default");
    expect(source).toContain("the example carries its own deterministic implementation");
    expect(source).not.toContain("areaSummary ships a working default");
  });

  it('leaves the interactive template\'s prose intact too — "example" is a word, not the declared id', () => {
    const root = sandbox();
    run(root, [TARIFF, INTERACTIVE, "Tariff settings"]);

    // The same property as the case above, for the interactive template: its declared id is a compound
    // (`example-interactive`), so the blunt pass rewrites the id and the identifier but leaves the bare word
    // "example" in the template's own comments. A rule mapping that word onto the identifier would have turned
    // the opening comment into the copy's own name.
    const index = moduleFile(root, TARIFF, "index.tsx");

    expect(index).toContain("a working example"); // the template's opening comment
    expect(index).not.toContain("a working tariffSettings"); // the identifier substituted for the word
    expect(index).not.toContain(EXAMPLE_ID); // the declared id itself is gone
  });

  it("rewrites the names the template gives itself, not only its id", () => {
    const root = sandbox();
    run(root, [TARIFF, INTERACTIVE]);

    // These are the template's own layer and form-control ids, and they are not its declared id, so no id rule
    // reaches them. They were rewritten by accident until the template was renamed — the bare-id rule used to
    // catch the short word inside `example-area` — so a copy that still ships them is a real regression, and the
    // acceptance for it is these three literals rather than the absence of the template's id.
    const index = moduleFile(root, TARIFF, "index.tsx");

    expect(index).not.toContain("example-area");
    expect(index).not.toContain("example-name");
    expect(index).not.toContain("example-resolution");
    expect(index).toContain(`${TARIFF}-area`);
    expect(index).toContain(`${TARIFF}-name`);
    expect(index).toContain(`${TARIFF}-resolution`);
  });

  it("derives the identifier from an id with no dash", () => {
    const root = sandbox();
    const result = run(root, [DASHBOARD, INTERACTIVE]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`registered it as "${DASHBOARD}"`);
    expect(registryOf(root)).toContain(`import ${DASHBOARD} from "../modules/${DASHBOARD}";`);
  });

  it("prints how to land the module (branch, commit, pull request)", () => {
    const root = sandbox();
    const result = run(root, [TARIFF, AUTO]);

    expect(result.stdout).toContain(`git switch -c add-${TARIFF}`);
    expect(result.stdout).toContain(`git commit -m "Add the ${TARIFF} module"`);
    expect(result.stdout).toContain("open a pull request against enerplanet/enerplanet");
  });

  it("reports per-file replacements so a blunt substitution is never silent", () => {
    const root = sandbox();
    const result = run(root, [TARIFF, INTERACTIVE]);

    // Every scanned file is listed, with a count, whether or not it changed.
    expect(result.stdout).toMatch(/index\.tsx: \d+ replacements? — /);
    expect(result.stdout).toMatch(/package\.json: \d+ replacements? — /);
    expect(result.stdout).toContain("vitest.config.ts: 0 replacements — no matches");
  });

  it("refuses a malformed id", () => {
    const result = run(sandbox(), ["Bad_Id", INTERACTIVE]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("usage: new-module.mjs <id> <type>");
  });

  it("refuses a missing or unknown type", () => {
    const missing = run(sandbox(), [TARIFF]);
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain(`type: ${INTERACTIVE} | ${AUTO}`);

    const unknown = run(sandbox(), [TARIFF, "bogus"]);
    expect(unknown.status).toBe(1);
    expect(unknown.stderr).toContain(`type: ${INTERACTIVE} | ${AUTO}`);
  });

  it("refuses an id whose target directory already exists", () => {
    const root = sandbox();
    mkdirSync(join(root, "modules", TARIFF), { recursive: true });
    const registryBefore = registryOf(root);

    const result = run(root, [TARIFF, INTERACTIVE]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("already exists");
    // Nothing was spliced on the way out.
    expect(registryOf(root)).toBe(registryBefore);
  });

  it("refuses the reserved names", () => {
    for (const id of [EXAMPLE_ID, TEMPLATE_ID, "examples"]) {
      const result = run(sandbox(), [id, INTERACTIVE]);
      expect(result.status, id).toBe(1);
      expect(result.stderr, id).toContain("reserved");
    }
  });

  it("never writes into the real checkout", () => {
    // Every case above ran in a temp copy; this asserts none of them reached the repository.
    expect(sha256(registryPath)).toBe(registryHashBefore);
    for (const id of [TARIFF, AREA, DASHBOARD]) {
      expect(existsSync(join(featureDir, "modules", id))).toBe(false);
    }
  });
});
