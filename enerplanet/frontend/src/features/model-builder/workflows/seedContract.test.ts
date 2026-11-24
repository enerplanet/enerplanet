/** The contract between this feature and the backend's seed files: the copy payload pastes back byte-identically, and the seeded fragment composes into the seeded flow. Skipped when the files are absent. */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { MODULES } from "../shell/moduleRegistry";
import { copyPayload } from "./document";
import { expand, type WorkflowLookup } from "./expand";
import { producedPorts, subflowVerdict } from "./gate";
import type { WorkflowDocument } from "./types";

/** `enerplanet/backend` resolved from this file's own directory, so the runner's cwd does not matter. */
const seedDir = fileURLToPath(new URL("../../../../../backend/cmd/seed/", import.meta.url));

function seedNames(): string[] {
  try {
    return readdirSync(seedDir).filter((name) => name.endsWith(".json"));
  } catch {
    return [];
  }
}

/** Every seed document, by file name, read once: both cases below are about the same set. */
const documents = new Map<string, WorkflowDocument>();
for (const name of seedNames()) {
  try {
    documents.set(name, JSON.parse(readFileSync(`${seedDir}${name}`, "utf8")) as WorkflowDocument);
  } catch {
    // A seed file the frontend cannot read is not a contract it can assert; the skip below covers that.
  }
}

/** Resolve a subflow's target the way the app does: every stored document, keyed by its own id. */
const lookup: WorkflowLookup = (workflowId) =>
  [...documents.values()].find((document) => document.id === workflowId);

describe.skipIf(documents.size === 0)("the backend's seed files", () => {
  it("each paste back byte-identically through the copy button", () => {
    // Every seed file, not only the default: a new document is exactly where this went wrong twice.
    for (const [name, document] of documents) {
      expect(copyPayload(document), name).toBe(readFileSync(`${seedDir}${name}`, "utf8"));
    }
  });

  it("offer the adjustment fragment where the seeded flow provides what it needs", () => {
    const flow = documents.get("default_workflow.json");
    const fragment = documents.get("adjust_workflow.json");

    expect(flow, "default_workflow.json").toBeDefined();
    expect(fragment, "adjust_workflow.json").toBeDefined();
    if (flow === undefined || fragment === undefined) return;

    const registry = Object.fromEntries(MODULES.map((entry) => [entry.module.id, entry.module]));
    const produced = producedPorts(flow.nodes, MODULES, lookup);

    expect(fragment.isSubflow).toBe(true);
    // The whole verdict, not just "not ok", so a refusal prints the reason it refused.
    expect(subflowVerdict(fragment, produced, registry, lookup, flow.id)).toEqual({ ok: true });
  });

  it("composes the seeded variant flow — its subflow resolves from the same stored documents", () => {
    const variant = documents.get("variant_workflow.json");
    expect(variant, "variant_workflow.json").toBeDefined();
    if (variant === undefined) return;

    const registry = Object.fromEntries(MODULES.map((entry) => [entry.module.id, entry.module]));
    const flow = expand(variant, lookup, registry);

    expect(flow.map((node) => node.moduleId)).toEqual([
      "model-save",
      "model-variant",
      "building-configurator",
      "technologies",
      "run-meme-calliope",
      "run-meme-pypsa",
      "compare-variant",
    ]);
  });
});
