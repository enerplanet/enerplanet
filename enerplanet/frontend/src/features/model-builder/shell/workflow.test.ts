/**
 * The dev workflow source — static configuration today, a backend resource later (`spec/frame.md` §5).
 *
 * The loader's job is to turn untrusted configuration into exactly what the core already takes: a `Flow`,
 * a `ModuleRegistry`, and the seed ports that exist before any node runs. It is deliberately pure and
 * separate from the `import` of the JSON file, so the shape can be exercised without a fixture on disk —
 * and so the switch to a hosted workflow changes one binding, not this logic.
 *
 * The cases below are mostly the *refusals*. A workflow that names a module nobody registered, or places
 * two nodes under one id, cannot be walked; it should fail here, loudly, rather than half-work later.
 *
 * Written failing first.
 */
import { describe, it, expect } from "vitest";
import { toWorkflow, devWorkflow } from "./workflow";
import example from "../modules/example";
import { isValidFlow } from "../core/flow";
import type { BuilderModule } from "./contract";

/** The one module these cases place. */
const ENTRIES: readonly BuilderModule[] = [example];

/** Two ports the example module wants, so the seed is meaningful rather than empty. */
const SEED = { modelName: "Dev model", resolution: 60 };

const DEFINITION = {
  id: "dev-flow",
  label: "Development flow",
  seed: "testdata/dev-flow.json",
  nodes: [{ id: "example", moduleId: "example", label: "Example" }],
};

describe("a workflow definition becomes what the core takes", () => {
  it("registers the declared modules by their own id", () => {
    const workflow = toWorkflow(DEFINITION, ENTRIES, SEED);

    expect(workflow.id).toBe("dev-flow");
    expect(workflow.label).toBe("Development flow");
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
    expect(workflow.ref).toEqual({ id: "dev-flow", version: 3 });
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

describe("the dev workflow the shell actually loads", () => {
  it("is walkable: every node is placeable against its own seed", () => {
    const workflow = devWorkflow();

    // The core's own gating, not a re-implementation: the seed satisfies the first node, and each node
    // contributes its surface for the next.
    expect(isValidFlow(workflow.flow, workflow.registry, workflow.seeds)).toBe(true);
  });

  it("names the seed file the loader imports, so the two cannot drift apart", () => {
    // The definition carries the seed's path only so a reader knows where the data lives — this is what
    // keeps that name honest the day the seed becomes a fetch rather than an import.
    expect(devWorkflow().seedFile).toBe("testdata/dev-flow.json");
  });
});
