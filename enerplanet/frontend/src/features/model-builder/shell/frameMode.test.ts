/**
 * Which module the frame shows, and what its session starts from.
 *
 * Two modes, and the difference is not cosmetic. In **workflow** mode the module on screen is the node the
 * session sits on, and its data is the workflow's seed. In **test mode** a module is shown on its own,
 * seeded from its own test data, with no workflow and no position — which is what lets a module be developed
 * and *seen* before it is placed in anything.
 *
 * That is why this is a derivation worth its own cases rather than logic inside the JSX: the point of test
 * mode is precisely the module the workflow does **not** place, and the point of workflow mode is that the
 * position decides.
 *
 * Written failing first.
 */
import { describe, it, expect } from "vitest";
import { defineModule, requiredPorts } from "@model-builder/core";
import { frameView, type FrameMode } from "./frameMode";
import { toWorkflow } from "./workflow";
import example from "./fixtures";
import { createStore } from "../core/store";
import type { BuilderModule } from "./contract";

/** A module the workflow does not place — the case test mode exists for. */
const UNPLACED: BuilderModule = {
  module: defineModule({
    id: "unplaced",
    params: [{ port: "resolution", required: true }],
    affect: {},
    layout: [],
    run: () => undefined,
    validate: () => [],
  }),
  Component: () => null,
  mock: { resolution: 30 },
};

/** An automatic module — the case `frameView` reports `auto` for. The module declares it, not the node. */
const AUTO: BuilderModule = {
  module: defineModule({
    id: "auto-node",
    params: [{ port: "buildings", required: true }],
    affect: {},
    layout: [],
    auto: true,
    run: () => undefined,
    validate: () => [],
  }),
  Component: () => null,
  mock: {},
};

const DEFINITION = {
  id: "one",
  label: "One",
  seed: "testdata/dev-flow.json",
  nodes: [{ id: "example", moduleId: "example", label: "Example" }],
};

const ENTRIES: readonly BuilderModule[] = [example, UNPLACED];
const SEED = { modelName: "Frame fixture", resolution: 60 };
const WORKFLOW_MODE: FrameMode = { kind: "workflow" };

/** None of these documents composes a subflow, so the lookup resolves nothing. */
const noSubflows = () => undefined;

const workflowOf = () => toWorkflow(DEFINITION, ENTRIES, noSubflows, SEED);

describe("the frame's mode decides what is on screen, and what the session starts from", () => {
  it("in workflow mode: the node's module, stamped with the node id, seeded from the flow", () => {
    const workflow = workflowOf();

    const view = frameView(WORKFLOW_MODE, workflow, ENTRIES, createStore(workflow.initial));

    expect(view.entry?.module.id).toBe("example");
    expect(view.nodeId).toBe("example");
    expect(view.labelId).toBe("example"); // the node id: history names positions
    expect(view.seed).toEqual(workflow.initial);
  });

  it("in workflow mode the placement decides, not what else is registered", () => {
    const workflow = workflowOf();
    const store = createStore(workflow.initial);
    const placed = [example, UNPLACED];
    const twoNode = toWorkflow(
      { ...DEFINITION, nodes: [{ id: "solo", moduleId: "unplaced" }] },
      placed,
      noSubflows,
      SEED,
    );

    // The workflow places only `unplaced`, so that is what workflow mode shows — regardless of what else is
    // registered or which module was shown a moment ago.
    const view = frameView(WORKFLOW_MODE, twoNode, ENTRIES, store);

    expect(view.entry?.module.id).toBe("unplaced");
    expect(view.nodeId).toBe("solo");
  });

  it("in test mode: the picked module, even though the workflow does not place it", () => {
    const workflow = workflowOf();

    const view = frameView({ kind: "test", moduleId: "unplaced" }, workflow, ENTRIES, createStore(workflow.initial));

    expect(view.entry?.module.id).toBe("unplaced");
    // No position exists in test mode, so there is nothing to stamp a run with.
    expect(view.nodeId).toBeUndefined();
    expect(view.labelId).toBe("unplaced");
  });

  it("in test mode the session starts from the module's own test data, not the flow's seed", () => {
    const workflow = workflowOf();

    const view = frameView({ kind: "test", moduleId: "unplaced" }, workflow, ENTRIES, createStore(workflow.initial));

    expect(view.seed).toEqual({ resolution: 30 });
  });

  it("in test mode the module is always runnable — its test data satisfies its own declaration", () => {
    // The rule that makes test mode work, asserted rather than assumed: `required` is not enforced here
    // because nothing can be missing. A module whose test data does not cover its declaration fails its own
    // contract test; this case is about the frame honouring that.
    const view = frameView(
      { kind: "test", moduleId: "unplaced" },
      workflowOf(),
      ENTRIES,
      createStore({}),
    );

    const entry = view.entry;
    if (entry === undefined) throw new Error("expected an entry in test mode");

    const missing = requiredPorts(entry.module).filter((port) => view.seed[port] === undefined);
    expect(missing).toEqual([]);
  });

  it("shows nothing when test mode names a module nobody declared", () => {
    const view = frameView({ kind: "test", moduleId: "ghost" }, workflowOf(), ENTRIES, createStore({}));

    expect(view.entry).toBeUndefined();
  });

  it("shows nothing in workflow mode when the flow places nothing", () => {
    const empty = toWorkflow({ ...DEFINITION, nodes: [{ id: "example", moduleId: "example" }] }, ENTRIES, noSubflows, SEED);

    const view = frameView(WORKFLOW_MODE, { ...empty, flow: [] }, ENTRIES, createStore({}));

    expect(view.entry).toBeUndefined();
    expect(view.nodeId).toBeUndefined();
  });
});

describe("the frame reports whether the module on screen is automatic", () => {
  it("reports `auto: true` for a module that declares it — the node carries no flag of its own", () => {
    const entries: readonly BuilderModule[] = [example, AUTO];
    const placed = toWorkflow(
      { ...DEFINITION, nodes: [{ id: "auto", moduleId: "auto-node" }] },
      entries,
      noSubflows,
      SEED,
    );

    const view = frameView(WORKFLOW_MODE, placed, entries, createStore(placed.initial));

    expect(view.entry?.module.id).toBe("auto-node");
    expect(view.auto).toBe(true);
  });

  it("omits `auto` for an interactive module", () => {
    const workflow = workflowOf();

    const view = frameView(WORKFLOW_MODE, workflow, ENTRIES, createStore(workflow.initial));

    expect(view.entry?.module.id).toBe("example");
    expect(view.auto).toBeUndefined();
  });
});
