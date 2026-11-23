/**
 * Recommended sections (§6): what a terminal node offers, and how taking a section grows the flow.
 *
 * `appendRecommended` is a **plan addition** — it grows the transcript, it does not run anything — so the
 * tests pin the two facts that make that true: fresh, monotonic placement ids in order, and an input flow that
 * is left untouched.
 *
 * Written failing first.
 */
import { describe, expect, it } from "vitest";
import type { Flow } from "../core/flow";
import type { RecommendedSection, WorkflowDocument } from "./types";
import { appendRecommended, sectionsFor } from "./recommended";

const INSULATE: RecommendedSection = {
  key: "insulate",
  label: "Insulate",
  description: "Add insulation and re-run.",
  nodes: [
    { id: "buildings", moduleId: "building-configurator" },
    { id: "run", moduleId: "run-pypsa" },
  ],
};
const COMPARE: RecommendedSection = {
  key: "compare",
  label: "Compare",
  description: "Compare two runs.",
  nodes: [{ id: "compare", moduleId: "compare-variant" }],
};

const DOC: WorkflowDocument = {
  id: "dev-flow",
  version: 1,
  label: "Development flow",
  nodes: [{ id: "model-start", moduleId: "model-start" }],
  recommended: { "model-start": [INSULATE, COMPARE] },
};

const SEED: Flow = [{ id: "0-model-start", moduleId: "model-start" }];

describe("sectionsFor — the sections offered for a terminal", () => {
  it("returns them by the terminal's stable name, in the order declared", () => {
    expect(sectionsFor(DOC, "model-start").map((section) => section.key)).toEqual(["insulate", "compare"]);
  });

  it("returns none for a name the document does not key on", () => {
    expect(sectionsFor(DOC, "run-pypsa")).toEqual([]);
  });

  it("returns none when the document declares no recommended map at all", () => {
    const plain: WorkflowDocument = { id: "y", version: 1, label: "Y", nodes: [] };
    expect(sectionsFor(plain, "model-start")).toEqual([]);
  });
});

describe("appendRecommended — a plan addition", () => {
  it("appends the section's nodes as fresh placements, in order, with monotonic ids", () => {
    const grown = appendRecommended(SEED, INSULATE);

    expect(grown.map((node) => node.id)).toEqual(["0-model-start", "1-buildings", "2-run"]);
    expect(grown.map((node) => node.moduleId)).toEqual(["model-start", "building-configurator", "run-pypsa"]);
  });

  it("mints ids after the placements already present, so a second append stays monotonic", () => {
    const twice = appendRecommended(appendRecommended(SEED, INSULATE), INSULATE);

    expect(twice.map((node) => node.id)).toEqual([
      "0-model-start",
      "1-buildings",
      "2-run",
      "3-buildings",
      "4-run",
    ]);
  });

  it("does not mutate the input flow", () => {
    const before = SEED.slice();
    appendRecommended(SEED, INSULATE);

    expect(SEED).toHaveLength(1);
    expect(SEED).toEqual(before);
  });

  it("names a placement by the node's own id, or its moduleId when it has none", () => {
    const nameless: RecommendedSection = {
      key: "nameless",
      label: "Nameless",
      description: "A node authored without an id.",
      nodes: [{ id: "", moduleId: "lonely" }],
    };
    const grown = appendRecommended([], nameless);

    expect(grown[0].id).toBe("0-lonely");
  });
});
