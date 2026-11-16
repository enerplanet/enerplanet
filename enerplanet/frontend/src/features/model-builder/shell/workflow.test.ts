/**
 * The default-workflow loader — how the definition reaches the frame now that it is a database row
 * (`spec/frame.md` §5; plan `workflow-builder.md` §6, Stage 2).
 *
 * The loader's job is to turn untrusted configuration into exactly what the core already takes: a `Flow`,
 * a `ModuleRegistry`, and the seed ports that exist before any node runs. `toWorkflow` is deliberately pure
 * and separate from the fetch, so the shape can be exercised without a fixture or a server — and the cases
 * below are mostly the *refusals*. A workflow that names a module nobody registered, or places two nodes
 * under one id, cannot be walked; it should fail here, loudly, rather than half-work later.
 *
 * `loadDefaultWorkflow` is the one binding that fetches it, so it is pinned against a mocked client the way
 * the workflows service is. It reports *no default* as `undefined` rather than throwing — a data condition,
 * not a transport fault.
 *
 * Written failing first.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import example from "../modules/example";
import { MODULES } from "./moduleRegistry";
import { isValidFlow } from "../core/flow";
import type { BuilderModule } from "./contract";
import type { WorkflowSummary } from "../workflows/types";
import devFlowDefinition from "./workflow.dev.json";
import devSeed from "./testdata/dev-flow.json";

const get = vi.fn();
vi.mock("@/lib/axios", () => ({
  default: { get, post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

const { toWorkflow, loadDefaultWorkflow } = await import("./workflow");

/** The one module these cases place. */
const ENTRIES: readonly BuilderModule[] = [example];

/** Two ports the example module wants, so the seed is meaningful rather than empty. */
const SEED = { modelName: "Dev model", resolution: 60 };

/** The id the definition names itself, reused so the loader cases agree on it. */
const DEV_FLOW_ID = "dev-flow";

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
    const workflow = toWorkflow(DEFINITION, ENTRIES, SEED);

    expect(workflow.id).toBe(DEV_FLOW_ID);
    expect(workflow.label).toBe(DEV_FLOW_LABEL);
    expect(workflow.registry.example).toBe(example.module);
  });

  it("resolves the nodes into a flow the core can walk", () => {
    const workflow = toWorkflow(DEFINITION, ENTRIES, SEED);

    expect(workflow.flow).toHaveLength(1);
    expect(workflow.flow[0]).toEqual({ id: "example", moduleId: "example", label: "Example" });
  });

  it("takes the seed's own ports as the seeds — what exists before any node runs", () => {
    const workflow = toWorkflow(DEFINITION, ENTRIES, SEED);

    expect([...workflow.seeds].sort()).toEqual(["modelName", "resolution"]);
    expect(workflow.initial).toEqual(SEED);
  });

  it("refuses a node whose module is not declared", () => {
    const broken = { ...DEFINITION, nodes: [{ id: "nope", moduleId: "not-a-module" }] };

    expect(() => toWorkflow(broken, ENTRIES, SEED)).toThrow(/moduleId "not-a-module" is not declared/);
  });

  it("refuses two nodes sharing an id — a node id is how history names a position", () => {
    const broken = {
      ...DEFINITION,
      nodes: [
        { id: "example", moduleId: "example" },
        { id: "example", moduleId: "example" },
      ],
    };

    expect(() => toWorkflow(broken, ENTRIES, SEED)).toThrow(/duplicate node id "example"/);
  });

  it("refuses a definition that places nothing", () => {
    expect(() => toWorkflow({ ...DEFINITION, nodes: [] }, ENTRIES, SEED)).toThrow(/places no nodes/);
  });

  it("refuses a definition with no id", () => {
    expect(() => toWorkflow({ ...DEFINITION, id: "" }, ENTRIES, SEED)).toThrow(/has no id/);
  });

  it("builds the reference a session artefact points at, from the definition's own id and version", () => {
    const workflow = toWorkflow({ ...DEFINITION, version: 3 }, ENTRIES, SEED);

    // The reference is a fact about the workflow, not a constant some caller invented — which is why the
    // definition carries the version and this file builds the pair.
    expect(workflow.ref).toEqual({ id: DEV_FLOW_ID, version: 3 });
  });

  it("reads an absent version as 1 — v1 is the only version until flows are distributable", () => {
    expect(toWorkflow(DEFINITION, ENTRIES, SEED).ref.version).toBe(1);
  });

  it("refuses a version that is present but not a real one", () => {
    // Quietly reading a `0` or a string as "v1" would record a reference to a workflow that never existed.
    expect(() => toWorkflow({ ...DEFINITION, version: 0 }, ENTRIES, SEED)).toThrow(/invalid version/);
    expect(() => toWorkflow({ ...DEFINITION, version: "1" }, ENTRIES, SEED)).toThrow(/invalid version/);
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
});

describe("the shipped dev-flow fixture", () => {
  it("is walkable against the seed it names, so the fixture stays true as modules are added", () => {
    // No longer the builder's source (Stage 2), but it is the document the backend seeds, so it must stay
    // placeable: the core's own gating, not a re-implementation.
    const workflow = toWorkflow(devFlowDefinition, MODULES, devSeed);

    expect(isValidFlow(workflow.flow, workflow.registry, workflow.seeds)).toBe(true);
    expect(workflow.seedFile).toBe("testdata/dev-flow.json");
  });
});
