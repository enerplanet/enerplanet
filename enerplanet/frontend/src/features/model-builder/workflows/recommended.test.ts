/**
 * Recommended sections: what a terminal node offers, and how taking a section grows the flow.
 *
 * `appendRecommended` is a **plan addition** — it grows the transcript, it does not run anything — so the
 * tests pin the two facts that make that true: fresh, monotonic placement ids in order, and an input flow that
 * is left untouched.
 *
 * Written failing first.
 */
import { describe, expect, it } from "vitest";
import type { Flow } from "../core/flow";
import { createStore, type Store } from "../core/store";
import type { RecommendedSection, WorkflowDocument } from "./types";
import { appendRecommended, recommendedFor, sectionsFor } from "./recommended";

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

  it("replaces the placed flow with a longer one — monotonic ids, the appended node present", () => {
    // What the shell's `takeSection` does to the session's placed flow: a new, longer list, the section's
    // nodes appended at the next positions — never an edit of the flow it was handed.
    const placed: Flow = SEED;
    const grown = appendRecommended(placed, INSULATE);

    expect(grown).toHaveLength(placed.length + INSULATE.nodes.length);
    expect(grown.map((node) => node.id)).toEqual(["0-model-start", "1-buildings", "2-run"]);
    expect(grown.at(-1)).toEqual({ id: "2-run", moduleId: "run-pypsa" });
  });
});

/** A region of the store whose one placement has run, writing `modelName` — so `0-model-start` reads done. */
function startedStore(): Store {
  const store = createStore({ modelName: "seed" });
  store.applyTransaction(
    [{ op: "replace", path: "/modelName", prev: "seed", next: "run" }],
    [],
    { node: { id: "0-model-start", moduleId: "model-start" } },
  );
  return store;
}

describe("recommendedFor — the sections on offer after a run", () => {
  it("offers the finished terminal's sections, in the order declared", () => {
    expect(recommendedFor(SEED, startedStore(), DOC).map((section) => section.key)).toEqual(["insulate", "compare"]);
  });

  it("offers nothing while a run is still unfinished — the placement has committed nothing yet", () => {
    // A store with no log: `0-model-start` is still pending, so no terminal has finished.
    expect(recommendedFor(SEED, createStore({ modelName: "seed" }), DOC)).toEqual([]);
  });

  it("offers nothing while a placement after the terminal is still pending", () => {
    // The newest done placement is `0-model-start`, but the tip is `1-extra` — the run has not reached a
    // settled end, so nothing is offered.
    const flow: Flow = [...SEED, { id: "1-extra", moduleId: "run-pypsa" }];
    expect(recommendedFor(flow, startedStore(), DOC)).toEqual([]);
  });

  it("offers nothing when the finished terminal is one the document does not name", () => {
    const doc: WorkflowDocument = { ...DOC, recommended: { "run-pypsa": [COMPARE] } };
    expect(recommendedFor(SEED, startedStore(), doc)).toEqual([]);
  });

  it("offers nothing once a section's own nodes are appended pending — the tip is no longer the terminal", () => {
    const grown = appendRecommended(SEED, INSULATE);
    expect(recommendedFor(grown, startedStore(), DOC)).toEqual([]);
  });
});
