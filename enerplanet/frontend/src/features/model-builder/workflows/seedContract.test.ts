/**
 * The contract between this feature and the backend's seed files.
 *
 * Two claims, and neither survived its first encounter with reality — both are claims about *those files*
 * rather than about a fixture that resembles them, which is why no unit test caught either:
 *
 * 1. **The copy button's payload pastes back byte-identically.** A developer copies a workflow out of the app
 *    and pastes it over the seed file, so key order and formatting have to agree — including the key order
 *    `jsonb` cannot preserve for us. This drifted twice: once on a key the order did not know about, once on
 *    a field added to the file alone.
 * 2. **The seeded adjustment fragment composes into the seeded flow.** That is the feature: a fragment
 *    inserted into a chain, offered only where the chain already provides what its expansion needs. It is
 *    what the picker renders, so if it stops holding, the feature is quietly unusable.
 *
 * So both read the files directly. Skipped, not failed, when they are absent: the two sit in one repository,
 * but the frontend is buildable on its own, and a missing neighbour is not a broken contract.
 */
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

    // The registry as the loader builds it, and the ports the whole seeded flow produces — so this is the
    // verdict for inserting the fragment at the end of that chain.
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
    // A mistyped moduleId or an unresolved subflow target throws here — this is the loader's own refusal, run
    // through the same `expand` the builder walks the document with, so a broken new document fails loudly.
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
