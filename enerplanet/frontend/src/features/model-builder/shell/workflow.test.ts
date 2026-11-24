/**
 * The default-workflow loader: `toWorkflow` turns an untrusted definition into a flow, a registry and
 * seed ports, and mostly refuses what cannot be walked.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import example from "./fixtures";
import { MODULES } from "./moduleRegistry";
import { isValidFlow } from "../core/flow";
import type { BuilderModule } from "./contract";
import type { WorkflowDocument, WorkflowSummary } from "../workflows/types";
import type { WorkflowLookup } from "../workflows/expand";
import devFlowDefinition from "./workflow.dev.json";
import devSeed from "./testdata/dev-flow.json";

const get = vi.fn();
vi.mock("@/lib/axios", () => ({
  default: { get, post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

const { toWorkflow, loadDefaultWorkflow } = await import("./workflow");

/** The one module these cases place. */
const ENTRIES: readonly BuilderModule[] = [example];

/** Two ports the fixture wants, so the seed is meaningful rather than empty. */
const SEED = { modelName: "Dev model", resolution: 60 };

/**
 * A lookup resolving nothing. The cases that do not compose a subflow still take one — the loader now builds
 * its flow through `expand`, which needs the seam — and an empty lookup is what a document with no subflow
 * node effectively sees.
 */
const noLookup: WorkflowLookup = () => undefined;

/** A lookup over the given documents, keyed by each document's own id — the id a subflow references. */
const lookupFrom = (...documents: WorkflowDocument[]): WorkflowLookup => {
  const byId = new Map(documents.map((document) => [document.id, document]));
  return (workflowId) => byId.get(workflowId);
};

/** The id the definition names itself, reused so the loader cases agree on it. */
const DEV_FLOW_ID = "dev-flow";

/** The child workflow these cases insert as a subflow, and the one a fragment-insertion case names. */
const CHILD_FLOW_ID = "adjust-flow";

/** Its label, likewise. */
const DEV_FLOW_LABEL = "Development flow";

const DEFINITION = {
  id: DEV_FLOW_ID,
  label: DEV_FLOW_LABEL,
  seed: "testdata/dev-flow.json",
  nodes: [{ id: "example", moduleId: "example", label: "Example" }],
};

describe("a workflow definition becomes what the core takes", () => {
  it("registers the declared modules by their own id", () => {
    const workflow = toWorkflow(DEFINITION, ENTRIES, noLookup, SEED);

    expect(workflow.id).toBe(DEV_FLOW_ID);
    expect(workflow.label).toBe(DEV_FLOW_LABEL);
    expect(workflow.registry.example).toBe(example.module);
  });

  it("resolves the nodes into a flow the core can walk", () => {
    const workflow = toWorkflow(DEFINITION, ENTRIES, noLookup, SEED);

    expect(workflow.flow).toHaveLength(1);
    expect(workflow.flow[0]).toEqual({ id: "example", moduleId: "example", label: "Example" });
  });

  it("takes the seed's own ports as the seeds — what exists before any node runs", () => {
    const workflow = toWorkflow(DEFINITION, ENTRIES, noLookup, SEED);

    expect([...workflow.seeds].sort()).toEqual(["modelName", "resolution"]);
    expect(workflow.initial).toEqual(SEED);
  });

  it("refuses a node whose module is not declared", () => {
    const broken = { ...DEFINITION, nodes: [{ id: "nope", moduleId: "not-a-module" }] };

    expect(() => toWorkflow(broken, ENTRIES, noLookup, SEED)).toThrow(/moduleId "not-a-module" is not declared/);
  });

  it("refuses two nodes sharing an id — a node id is how history names a position", () => {
    const broken = {
      ...DEFINITION,
      nodes: [
        { id: "example", moduleId: "example" },
        { id: "example", moduleId: "example" },
      ],
    };

    expect(() => toWorkflow(broken, ENTRIES, noLookup, SEED)).toThrow(/duplicate node id "example"/);
  });

  it("refuses a definition that places nothing", () => {
    expect(() => toWorkflow({ ...DEFINITION, nodes: [] }, ENTRIES, noLookup, SEED)).toThrow(/places no nodes/);
  });

  it("expands a subflow node through the lookup, splicing its nodes in at that position", () => {
    const child = {
      id: CHILD_FLOW_ID,
      version: 1,
      label: "Adjust",
      nodes: [{ id: "example", moduleId: "example", label: "Example" }],
    };
    const document = {
      ...DEFINITION,
      nodes: [{ id: "adjust", workflows: [CHILD_FLOW_ID], label: "Adjust" }],
    };

    const workflow = toWorkflow(document, ENTRIES, lookupFrom(child), SEED);

    // The subflow node itself is not emitted — it is not a module — and its child is namespaced by its id and
    // labelled under its label, the flattening `expand` defines.
    expect(workflow.flow).toEqual([
      { id: "adjust/example", moduleId: "example", label: "Adjust / Example" },
    ]);
  });

  it("refuses a subflow naming a workflow the lookup does not resolve", () => {
    const document = { ...DEFINITION, nodes: [{ id: "adjust", workflows: ["nope"] }] };

    expect(() => toWorkflow(document, ENTRIES, noLookup, SEED)).toThrow(
      /workflow "dev-flow" node "adjust": subflow workflow "nope" is not a stored workflow/,
    );
  });

  it("refuses an undeclared module named inside a child workflow, in the loader's message shape", () => {
    const child = {
      id: CHILD_FLOW_ID,
      version: 1,
      label: "Adjust",
      nodes: [{ id: "n", moduleId: "not-a-module" }],
    };
    const document = { ...DEFINITION, nodes: [{ id: "adjust", workflows: [CHILD_FLOW_ID] }] };

    // The check lives in `expand` now, but the refusal is the same one the loader made at the root.
    expect(() => toWorkflow(document, ENTRIES, lookupFrom(child), SEED)).toThrow(
      /workflow "adjust-flow" node "n": moduleId "not-a-module" is not declared/,
    );
  });

  it("refuses a fragment as a flow of its own, naming it and why", () => {
    const fragment = { ...DEFINITION, isSubflow: true };

    expect(() => toWorkflow(fragment, ENTRIES, noLookup, SEED)).toThrow(
      /workflow "dev-flow" is a fragment \(isSubflow\)/,
    );
  });

  it("refuses a definition with no id", () => {
    expect(() => toWorkflow({ ...DEFINITION, id: "" }, ENTRIES, noLookup, SEED)).toThrow(/has no id/);
  });

  it("builds the reference a session artefact points at, from the definition's own id and version", () => {
    const workflow = toWorkflow({ ...DEFINITION, version: 3 }, ENTRIES, noLookup, SEED);

    // The reference is a fact about the workflow, not a constant some caller invented — which is why the
    // definition carries the version and this file builds the pair.
    expect(workflow.ref).toEqual({ id: DEV_FLOW_ID, version: 3 });
  });

  it("reads an absent version as 1 — v1 is the only version until flows are distributable", () => {
    expect(toWorkflow(DEFINITION, ENTRIES, noLookup, SEED).ref.version).toBe(1);
  });

  it("refuses a version that is present but not a real one", () => {
    // Quietly reading a `0` or a string as "v1" would record a reference to a workflow that never existed.
    expect(() => toWorkflow({ ...DEFINITION, version: 0 }, ENTRIES, noLookup, SEED)).toThrow(/invalid version/);
    expect(() => toWorkflow({ ...DEFINITION, version: "1" }, ENTRIES, noLookup, SEED)).toThrow(/invalid version/);
  });
});

/** Two rows: one default carrying the shipped document, one not, so "find the default" is the thing tested. */
const defaultRow: WorkflowSummary = {
  workflow_id: DEV_FLOW_ID,
  version: 1,
  label: DEV_FLOW_LABEL,
  definition: devFlowDefinition,
  is_default: true,
};

const otherRow: WorkflowSummary = {
  workflow_id: "other",
  version: 1,
  label: "Other",
  definition: { id: "other", version: 1, label: "Other", nodes: [{ id: "example", moduleId: "example" }] },
  is_default: false,
};

describe("the workflow the shell actually loads", () => {
  beforeEach(() => {
    get.mockReset();
  });

  it("fetches the list and builds from the row marked default, not the first", async () => {
    get.mockResolvedValueOnce({ data: { data: [otherRow, defaultRow] } });

    const workflow = await loadDefaultWorkflow();

    expect(get).toHaveBeenCalledWith("/workflows");
    expect(workflow?.id).toBe(DEV_FLOW_ID);
    expect(workflow?.flow).toHaveLength(devFlowDefinition.nodes.length);
  });

  it("returns undefined when nothing is marked default — a data condition the shell reports, not a throw", async () => {
    get.mockResolvedValueOnce({ data: { data: [otherRow] } });

    await expect(loadDefaultWorkflow()).resolves.toBeUndefined();
  });

  it("lets a rejected fetch throw, so the shell can report it rather than render an empty frame", async () => {
    get.mockRejectedValueOnce(new Error("offline"));

    await expect(loadDefaultWorkflow()).rejects.toThrow("offline");
  });

  it("resolves a subflow from the same list — one fetch, no per-subflow request", async () => {
    // The fragment is a row like any other: it is refused only as the flow *to run*, and inserting it as a
    // subflow is exactly what `isSubflow` is for. One `GET /workflows` supplies both it and the default.
    const childRow: WorkflowSummary = {
      workflow_id: CHILD_FLOW_ID,
      version: 1,
      label: "Adjust",
      definition: {
        id: CHILD_FLOW_ID,
        version: 1,
        label: "Adjust",
        isSubflow: true,
        nodes: [{ id: "area-draw", moduleId: "area-draw", label: "Area" }],
      },
      is_default: false,
      is_subflow: true,
    };
    const composedRow: WorkflowSummary = {
      workflow_id: "composed",
      version: 1,
      label: "Composed",
      definition: {
        id: "composed",
        version: 1,
        label: "Composed",
        nodes: [{ id: "adjust", workflows: [CHILD_FLOW_ID], label: "Adjust" }],
      },
      is_default: true,
    };
    get.mockResolvedValueOnce({ data: { data: [childRow, composedRow] } });

    const workflow = await loadDefaultWorkflow();

    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith("/workflows");
    expect(workflow?.flow).toEqual([
      { id: "adjust/area-draw", moduleId: "area-draw", label: "Adjust / Area" },
    ]);
  });

  it("refuses a default that is a fragment, so a fragment is never run as its own flow", async () => {
    const fragmentRow: WorkflowSummary = {
      workflow_id: CHILD_FLOW_ID,
      version: 1,
      label: "Adjust",
      definition: {
        id: CHILD_FLOW_ID,
        version: 1,
        label: "Adjust",
        isSubflow: true,
        nodes: [{ id: "area-draw", moduleId: "area-draw" }],
      },
      is_default: true,
    };
    get.mockResolvedValueOnce({ data: { data: [fragmentRow] } });

    await expect(loadDefaultWorkflow()).rejects.toThrow(/workflow "adjust-flow" is a fragment \(isSubflow\)/);
  });
});

describe("the workflow a requested id names", () => {
  beforeEach(() => {
    get.mockReset();
  });

  /** The id a request names — the pathway the picker will drive, as a stored flow of its own. */
  const REQUESTED_FLOW_ID = "variant-flow";

  it("loads the row whose document id was requested, not the one marked default", async () => {
    // The request is the seam the picker drives: a pathway is a different load, so the builder is handed
    // which stored flow to open. Matched on the document's own id — the id a session references.
    const variantRow: WorkflowSummary = {
      workflow_id: REQUESTED_FLOW_ID,
      version: 1,
      label: "Variant exploration",
      definition: {
        id: REQUESTED_FLOW_ID,
        version: 1,
        label: "Variant exploration",
        nodes: [{ id: "model-start", moduleId: "model-start", label: "Model start" }],
      },
      is_default: false,
    };
    get.mockResolvedValueOnce({ data: { data: [defaultRow, variantRow] } });

    const workflow = await loadDefaultWorkflow(REQUESTED_FLOW_ID);

    expect(workflow?.id).toBe(REQUESTED_FLOW_ID);
  });

  it("returns undefined for a requested id no stored workflow carries — the same path a missing default uses", async () => {
    // No fallback to the default: a named flow that does not exist is the data condition the shell reports.
    get.mockResolvedValueOnce({ data: { data: [defaultRow] } });

    await expect(loadDefaultWorkflow("does-not-exist")).resolves.toBeUndefined();
  });
});

describe("the loader refuses a malformed recommended map", () => {
  /** A well-formed section: the map is untrusted input, so what it accepts is pinned beside what it refuses. */
  const GOOD_SECTION = {
    key: "insulate",
    label: "Insulate",
    description: "Add insulation and re-run.",
    nodes: [{ id: "example", moduleId: "example" }],
  };

  it("accepts a well-formed map and carries the document through", () => {
    const document = { ...DEFINITION, recommended: { example: [GOOD_SECTION] } };

    const workflow = toWorkflow(document, ENTRIES, noLookup, SEED);

    expect(workflow.document.recommended?.example?.[0]?.key).toBe("insulate");
  });

  it("refuses a blank terminal name", () => {
    const document = { ...DEFINITION, recommended: { "": [GOOD_SECTION] } };

    expect(() => toWorkflow(document, ENTRIES, noLookup, SEED)).toThrow(
      /malformed recommended map.*blank terminal name/,
    );
  });

  it("refuses two sections sharing a key", () => {
    const document = { ...DEFINITION, recommended: { example: [GOOD_SECTION], other: [{ ...GOOD_SECTION }] } };

    expect(() => toWorkflow(document, ENTRIES, noLookup, SEED)).toThrow(
      /malformed recommended map.*share the key "insulate"/,
    );
  });

  it("refuses a section whose node fails the discriminant", () => {
    const document = {
      ...DEFINITION,
      recommended: { example: [{ ...GOOD_SECTION, nodes: [{ id: "x" }] }] },
    };

    expect(() => toWorkflow(document, ENTRIES, noLookup, SEED)).toThrow(
      /malformed recommended map.*malformed node/,
    );
  });
});

describe("the shipped dev-flow fixture", () => {
  it("is walkable against the seed it names, so the fixture stays true as modules are added", () => {
    // No longer the builder's source (Stage 2), but it is the document the backend seeds, so it must stay
    // placeable: the core's own gating, not a re-implementation.
    const workflow = toWorkflow(devFlowDefinition, MODULES, noLookup, devSeed);

    expect(isValidFlow(workflow.flow, workflow.registry, workflow.seeds)).toBe(true);
    expect(workflow.seedFile).toBe("testdata/dev-flow.json");
  });
});
