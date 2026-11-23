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
import { barState } from "./barState";
import { toWorkflow } from "./workflow";
import example from "./fixtures";
import { createStore } from "../core/store";
import { transcript } from "../core/flow";
import { portPath } from "../core/diff";
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

    const view = frameView(WORKFLOW_MODE, workflow, ENTRIES, createStore(workflow.initial), workflow.flow);

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
    const view = frameView(WORKFLOW_MODE, twoNode, ENTRIES, store, twoNode.flow);

    expect(view.entry?.module.id).toBe("unplaced");
    expect(view.nodeId).toBe("solo");
  });

  it("in test mode: the picked module, even though the workflow does not place it", () => {
    const workflow = workflowOf();

    const view = frameView({ kind: "test", moduleId: "unplaced" }, workflow, ENTRIES, createStore(workflow.initial), workflow.flow);

    expect(view.entry?.module.id).toBe("unplaced");
    // No position exists in test mode, so there is nothing to stamp a run with.
    expect(view.nodeId).toBeUndefined();
    expect(view.labelId).toBe("unplaced");
  });

  it("in test mode the session starts from the module's own test data, not the flow's seed", () => {
    const workflow = workflowOf();

    const view = frameView({ kind: "test", moduleId: "unplaced" }, workflow, ENTRIES, createStore(workflow.initial), workflow.flow);

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
      workflowOf().flow,
    );

    const entry = view.entry;
    if (entry === undefined) throw new Error("expected an entry in test mode");

    const missing = requiredPorts(entry.module).filter((port) => view.seed[port] === undefined);
    expect(missing).toEqual([]);
  });

  it("shows nothing when test mode names a module nobody declared", () => {
    const view = frameView({ kind: "test", moduleId: "ghost" }, workflowOf(), ENTRIES, createStore({}), workflowOf().flow);

    expect(view.entry).toBeUndefined();
  });

  it("shows nothing in workflow mode when the flow places nothing", () => {
    const empty = toWorkflow({ ...DEFINITION, nodes: [{ id: "example", moduleId: "example" }] }, ENTRIES, noSubflows, SEED);

    const view = frameView(WORKFLOW_MODE, { ...empty, flow: [] }, ENTRIES, createStore({}), []);

    expect(view.entry).toBeUndefined();
    expect(view.nodeId).toBeUndefined();
  });
});

describe("the frame can be held on a node while its run is in flight", () => {
  /**
   * The mechanism an **auto** node depends on.
   *
   * The position is derived, and an auto node's own output is what makes it done — so the frame would move off
   * the node in the very React commit that delivers its writes, and a module that draws from what it just
   * produced (the grid generator, above all) would unmount before its effect ever drew. A `hold` keeps it on
   * screen; the shell sets it for the duration of a run and clears it once the paint has landed (`BuilderShell`).
   */
  it("shows the held node even though the derived position is a different one", () => {
    const workflow = toWorkflow(
      {
        ...DEFINITION,
        nodes: [
          { id: "one", moduleId: "example" },
          { id: "two", moduleId: "unplaced" },
        ],
      },
      ENTRIES,
      noSubflows,
      SEED,
    );
    const store = createStore(workflow.initial);

    // Nothing has run, so the session's derived node is the first one.
    expect(frameView(WORKFLOW_MODE, workflow, ENTRIES, store, workflow.flow).nodeId).toBe("one");

    // Held on the second: the frame must show it, not the derived first node.
    const held = frameView(WORKFLOW_MODE, workflow, ENTRIES, store, workflow.flow, "two");
    expect(held.nodeId).toBe("two");
    expect(held.entry?.module.id).toBe("unplaced");
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

    const view = frameView(WORKFLOW_MODE, placed, entries, createStore(placed.initial), placed.flow);

    expect(view.entry?.module.id).toBe("auto-node");
    expect(view.auto).toBe(true);
  });

  it("omits `auto` for an interactive module", () => {
    const workflow = workflowOf();

    const view = frameView(WORKFLOW_MODE, workflow, ENTRIES, createStore(workflow.initial), workflow.flow);

    expect(view.entry?.module.id).toBe("example");
    expect(view.auto).toBeUndefined();
  });
});

describe("the frame walks the transcript, not the seed — an appended successor placement shows up", () => {
  /**
   * A re-run **appends a successor placement** to the log rather than rewriting a placement in place (§3), so
   * the flow the frame must walk is `transcript(session.flow, store.log)`, not the seed `workflow.flow`. The
   * shell derives that transcript once and threads it into the frame, the bar and the steps panel; this pins
   * the shape it relies on — given a store whose log carries an appended placement, the transcript has one more
   * node, and the frame and the bar both show it, where the seed flow would still show the node it replaced.
   */
  it("the derived flow is the transcript: the appended placement is a node, and the frame and bar show it", () => {
    const workflow = workflowOf();
    const store = createStore(workflow.initial);

    // The seed placement runs, so it is done and the frontier would otherwise move past it.
    store.applyTransaction([], [], { node: { id: "example", moduleId: "example" } });
    // A re-run appends a successor placement — same module, a fresh placement id — and its work is then pruned,
    // so it is the placement the session is *on* rather than a finished one.
    store.applyTransaction(
      [{ op: "replace", path: portPath("resolution"), prev: 60, next: 30 }],
      [],
      { node: { id: "1-example", moduleId: "example" } },
    );
    store.applyTransaction([{ op: "remove", path: portPath("resolution"), prev: 30 }]);

    // The drawn flow *is* the transcript: the seed placement plus the one the log appended.
    const flow = transcript(workflow.flow, store.log);
    expect(flow.map((node) => node.id)).toEqual(["example", "1-example"]);

    // The frame, handed the transcript, walks to the appended placement (the frontier) — not the seed's node.
    const view = frameView(WORKFLOW_MODE, workflow, ENTRIES, store, flow);
    expect(view.nodeId).toBe("1-example");
    expect(view.entry?.module.id).toBe("example");

    // The bar walks the same transcript: it names the appended placement as current and the seed one as prior.
    const bar = barState(flow, workflow.registry, store);
    expect(bar.current?.id).toBe("1-example");
    expect(bar.prior?.id).toBe("example");

    // The seed flow, by contrast, would still show the node the re-run replaced — the invisible-successor bug.
    expect(frameView(WORKFLOW_MODE, workflow, ENTRIES, store, workflow.flow).nodeId).toBe("example");
    expect(barState(workflow.flow, workflow.registry, store).current?.id).toBe("example");
  });
});
