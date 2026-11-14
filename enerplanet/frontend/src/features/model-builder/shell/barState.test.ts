/**
 * The workflow bar's state — where the session is (`spec/frame.md` §3.1).
 *
 * The bar answers one question, and the answer is *derived* from `(flow, registry, store)`, never stored:
 * prior is the node before the position, current is the node the session sits on, next is the one after.
 * These cases pin the derivation, including the two readings that are easy to get wrong — a flow that has
 * finished still names the last node (that is what is on screen), and a node the session jumped back to
 * reads **stale**, not pending, because that is what the re-arm is for.
 *
 * Most cases build history directly through the store, because the bar is a pure derivation over history:
 * "given history shaped like this, the bar reads that". The one case that runs a real node does so to prove
 * the derivation survives the real write path, not to test the engine.
 *
 * Written failing first.
 */
import { describe, it, expect } from "vitest";
import { barState } from "./barState";
import { toWorkflow, type Workflow } from "./workflow";
import example, { hold } from "../modules/example";
import { createEngine } from "../core/engine";
import { jumpTo } from "../core/rerun";
import { portPath, type DiffOp } from "../core/diff";
import { createStore, type Store } from "../core/store";

/** Named once: the definition carries it, and a case asserts the loader agrees with it. */
const SEED_FILE = "testdata/dev-flow.json";

/** Two nodes of the one module we have: the smallest flow with a prior, a current and a next. */
const TWO_NODES = {
  id: "two",
  label: "Two steps",
  seed: SEED_FILE,
  nodes: [
    { id: "first", moduleId: "example", label: "First" },
    { id: "second", moduleId: "example", label: "Second" },
  ],
};

/** The seed's name, deliberately padded so the example module's `run()` produces a real diff — it trims. */
const SEED_NAME = "  Bar fixture  ";

const SEED = { modelName: SEED_NAME, resolution: 60 };

function workflowOf(definition: unknown): Workflow {
  return toWorkflow(definition, [example], SEED);
}

/** Seal one node's work, so a case can say "history looks like this" without running anything. */
function seal(store: Store, nodeId: string, next: string, prev: string): void {
  const op: DiffOp = { op: "replace", path: portPath("modelName"), prev, next };
  store.applyTransaction([op], [], { node: { id: nodeId } });
}

describe("the bar derives the session's position", () => {
  it("before anything runs: nothing prior, the first node current, the second next", () => {
    const workflow = workflowOf(TWO_NODES);

    const bar = barState(workflow.flow, workflow.registry, createStore(workflow.initial));

    expect(bar.prior).toBeUndefined();
    expect(bar.current).toEqual({ id: "first", label: "First", state: "pending" });
    expect(bar.next).toEqual({ id: "second", label: "Second", state: "pending" });
    expect(bar.complete).toBe(false);
  });

  it("after the first node runs for real: it is prior and done, the second is current", async () => {
    const workflow = workflowOf(TWO_NODES);
    const store = createStore(workflow.initial);

    // The example takes the values its regions collect through `hold()` (see the note on it), so driving it
    // for real means filling them the way a region does. A bare run commits nothing, by design.
    hold("first", { modelName: "  Bar fixture  " });
    await createEngine(store).runModule(example.module, { id: "first" });

    const bar = barState(workflow.flow, workflow.registry, store);

    expect(bar.prior).toEqual({ id: "first", label: "First", state: "done" });
    expect(bar.current).toEqual({ id: "second", label: "Second", state: "pending" });
    expect(bar.next).toBeUndefined(); // only two nodes
    expect(bar.complete).toBe(false);
  });

  it("with every node done: complete, and the current node is still the last one", () => {
    const workflow = workflowOf(TWO_NODES);
    const store = createStore(workflow.initial);

    seal(store, "first", "One", SEED_NAME);
    seal(store, "second", "Two", "One");

    const bar = barState(workflow.flow, workflow.registry, store);

    expect(bar.complete).toBe(true);
    expect(bar.prior).toEqual({ id: "first", label: "First", state: "done" });
    // Not blank: the session sits on the last node, so the bar keeps naming what is on screen.
    expect(bar.current).toEqual({ id: "second", label: "Second", state: "done" });
    expect(bar.next).toBeUndefined();
  });

  it("shows a node the session jumped back to as stale, not pending — the re-arm is visible", () => {
    const workflow = workflowOf(TWO_NODES);
    const store = createStore(workflow.initial);

    seal(store, "first", "One", SEED_NAME);
    seal(store, "second", "Two", "One");
    jumpTo(workflow.flow, workflow.registry, store, "first");

    const bar = barState(workflow.flow, workflow.registry, store);

    expect(bar.current).toEqual({ id: "first", label: "First", state: "stale" });
    // The jump re-armed its target *only*: the tail keeps its work and is elided when the target runs
    // again, unless the target's new value prunes what the tail used. So "next" reads done, not pending —
    // and that is the truth of the derivation, not a bug in the bar.
    expect(bar.next).toEqual({ id: "second", label: "Second", state: "done" });
    expect(bar.complete).toBe(false);
  });

  it("falls back to the module id when the definition gives a node no label", () => {
    const workflow = workflowOf({
      ...TWO_NODES,
      nodes: [{ id: "only", moduleId: "example" }],
    });

    const bar = barState(workflow.flow, workflow.registry, createStore(workflow.initial));

    expect(bar.current).toEqual({ id: "only", label: "example", state: "pending" });
  });

  it("has nothing to name when the flow places nothing", () => {
    const workflow = workflowOf({ ...TWO_NODES, nodes: [{ id: "only", moduleId: "example" }] });
    const store = createStore(workflow.initial);

    const bar = barState([], workflow.registry, store);

    expect(bar.current).toBeUndefined();
    expect(bar.prior).toBeUndefined();
    expect(bar.next).toBeUndefined();
    // An empty flow is vacuously complete per the core's own derivation (there is nothing left to do), so
    // the bar passes that through rather than inventing a second reading — the *view* keys on having no
    // current node when it needs to say "nothing to show here".
    expect(bar.complete).toBe(true);
  });
});
