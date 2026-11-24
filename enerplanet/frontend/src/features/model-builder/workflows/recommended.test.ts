/** Recommended sections: what a finished run offers, and how taking a section grows the flow. */
import { describe, expect, it } from "vitest";
import type { Flow, ModuleRegistry } from "../core/flow";
import type { Module } from "../core/module";
import { createStore, type Store } from "../core/store";
import type { WorkflowLookup } from "./expand";
import type { RecommendedSection, WorkflowDocument } from "./types";
import { appendRecommended, recommendedFor, takeableSections } from "./recommended";

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
  recommended: [INSULATE, COMPARE],
};

const SEED: Flow = [{ id: "0-model-start", moduleId: "model-start" }];

/** A lookup resolving nothing — a module-only section needs no subflow. */
const noLookup: WorkflowLookup = () => undefined;

function module(id: string): Module {
  return { id, name: id, params: [], affect: {}, layout: ["sidebar"] };
}

/** The build the module-only fixtures run against: their modules, and only those. */
const MODULES: ModuleRegistry = {
  "building-configurator": module("building-configurator"),
  "run-pypsa": module("run-pypsa"),
  "compare-variant": module("compare-variant"),
  lonely: module("lonely"),
};

describe("appendRecommended — a plan addition", () => {
  it("appends the section's nodes as fresh placements, in order, with monotonic ids", () => {
    const grown = appendRecommended(SEED, INSULATE, noLookup, MODULES);

    expect(grown.map((node) => node.id)).toEqual(["0-model-start", "1-buildings", "2-run"]);
    expect(grown.map((node) => node.moduleId)).toEqual(["model-start", "building-configurator", "run-pypsa"]);
  });

  it("mints ids after the placements already present, so a second append stays monotonic", () => {
    const twice = appendRecommended(
      appendRecommended(SEED, INSULATE, noLookup, MODULES),
      INSULATE,
      noLookup,
      MODULES,
    );

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
    appendRecommended(SEED, INSULATE, noLookup, MODULES);

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
    const grown = appendRecommended([], nameless, noLookup, MODULES);

    expect(grown[0].id).toBe("0-lonely");
  });

  it("drops a subflow that cannot be resolved, leaving the flow otherwise intact", () => {
    const broken: RecommendedSection = {
      key: "broken",
      label: "Broken",
      description: "Names a workflow this build does not have.",
      nodes: [{ id: "s", workflows: ["nope"] }],
    };

    expect(appendRecommended(SEED, broken, noLookup, MODULES)).toEqual(SEED);
  });
});

describe("appendRecommended — a subflow suggestion flattens to runnable modules", () => {
  const child: WorkflowDocument = {
    id: "child",
    version: 1,
    label: "Child",
    nodes: [
      { id: "a", moduleId: "m1", label: "A" },
      { id: "b", moduleId: "m2", label: "B" },
    ],
  };
  const lookup: WorkflowLookup = (workflowId) => (workflowId === "child" ? child : undefined);
  const registry: ModuleRegistry = { m1: module("m1"), m2: module("m2") };
  const SECTION: RecommendedSection = {
    key: "adjust",
    label: "Adjust",
    description: "Splice a workflow in.",
    nodes: [{ id: "sub", workflows: ["child"], label: "Child" }],
  };

  it("turns the subflow into module nodes with non-empty moduleIds and namespaced ids", () => {
    const grown = appendRecommended(SEED, SECTION, lookup, registry);

    expect(grown).toEqual([
      { id: "0-model-start", moduleId: "model-start" },
      { id: "1-sub/a", moduleId: "m1", label: "Child / A" },
      { id: "2-sub/b", moduleId: "m2", label: "Child / B" },
    ]);
    for (const node of grown) expect(node.moduleId.length).toBeGreaterThan(0);
  });

  it("keeps the rest of a section's nodes when one subflow cannot be resolved", () => {
    const mixed: RecommendedSection = {
      key: "mixed",
      label: "Mixed",
      description: "One module, one broken subflow, one module.",
      nodes: [
        { id: "first", moduleId: "m1" },
        { id: "sub", workflows: ["nope"] },
        { id: "last", moduleId: "m2" },
      ],
    };
    const grown = appendRecommended([], mixed, lookup, registry);

    expect(grown.map((node) => node.moduleId)).toEqual(["m1", "m2"]);
  });
});

describe("takeableSections — what a run may still offer", () => {
  it("keeps a section whose every step this build can run", () => {
    expect(takeableSections([INSULATE, COMPARE], noLookup, MODULES).map((section) => section.key)).toEqual([
      "insulate",
      "compare",
    ]);
  });

  it("drops a section whose module this build does not declare", () => {
    const missing: RecommendedSection = {
      key: "missing",
      label: "Missing",
      description: "Names a module this build does not have.",
      nodes: [{ id: "x", moduleId: "not-declared" }],
    };

    expect(takeableSections([INSULATE, missing], noLookup, MODULES).map((section) => section.key)).toEqual([
      "insulate",
    ]);
  });

  it("drops a section whose subflow names a workflow that is not stored", () => {
    const broken: RecommendedSection = {
      key: "broken",
      label: "Broken",
      description: "Names a workflow this build does not have.",
      nodes: [{ id: "s", workflows: ["nope"] }],
    };

    expect(takeableSections([INSULATE, broken], noLookup, MODULES).map((section) => section.key)).toEqual([
      "insulate",
    ]);
  });

  it("drops a section with no steps, which would append nothing", () => {
    const empty: RecommendedSection = { key: "empty", label: "Empty", description: "", nodes: [] };

    expect(takeableSections([empty], noLookup, MODULES)).toEqual([]);
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

describe("recommendedFor — the suggestions on offer after a run", () => {
  it("offers the list once the last placement has finished", () => {
    expect(recommendedFor(SEED, startedStore(), DOC).map((section) => section.key)).toEqual(["insulate", "compare"]);
  });

  it("offers nothing while a run is still unfinished — the placement has committed nothing yet", () => {
    // A store with no log: `0-model-start` is still pending, so the tip has not finished.
    expect(recommendedFor(SEED, createStore({ modelName: "seed" }), DOC)).toEqual([]);
  });

  it("offers nothing while a placement after the terminal is still pending", () => {
    const flow: Flow = [...SEED, { id: "1-extra", moduleId: "run-pypsa" }];
    expect(recommendedFor(flow, startedStore(), DOC)).toEqual([]);
  });

  it("offers nothing when the document declares no list", () => {
    const plain: WorkflowDocument = { id: "y", version: 1, label: "Y", nodes: [] };
    expect(recommendedFor(SEED, startedStore(), plain)).toEqual([]);
  });

  it("offers nothing once a section's own nodes are appended pending — the tip is no longer the terminal", () => {
    const grown = appendRecommended(SEED, INSULATE, noLookup, MODULES);
    expect(recommendedFor(grown, startedStore(), DOC)).toEqual([]);
  });
});
