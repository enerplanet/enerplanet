/**
 * The workflow bar's state — prior / current / next derived from `(flow, registry, store)`; a finished
 * flow still names the last node.
 */
import { describe, it, expect } from "vitest";
import { barState } from "./barState";
import { toWorkflow, type Workflow } from "./workflow";
import example, { hold } from "./fixtures";
import { createEngine } from "../core/engine";
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

/** The seed's name, deliberately padded so the fixture's `run()` produces a real diff — it trims. */
const SEED_NAME = "  Bar fixture  ";

const SEED = { modelName: SEED_NAME, resolution: 60 };

/** None of these documents composes a subflow, so the lookup resolves nothing. */
const noSubflows = () => undefined;

function workflowOf(definition: unknown): Workflow {
  return toWorkflow(definition, [example], noSubflows, SEED);
}

/** Seal one node's work, so a case can say "history looks like this" without running anything. */
function seal(store: Store, nodeId: string, next: string, prev: string): void {
  const op: DiffOp = { op: "replace", path: portPath("modelName"), prev, next };
  store.applyTransaction([op], [], { node: { id: nodeId, moduleId: "example" } });
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

    // The fixture takes the values its regions collect through `hold()` (see the note on it), so driving it
    // for real means filling them the way a region does. A bare run commits nothing, by design.
    hold("first", { modelName: "  Bar fixture  " });
    await createEngine(store).runModule(example.module, { id: "first", moduleId: example.module.id });

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

  it("rests the bar on a node the session looks at, which stays done — a view writes nothing", () => {
    const workflow = workflowOf(TWO_NODES);
    const store = createStore(workflow.initial);

    seal(store, "first", "One", SEED_NAME);
    seal(store, "second", "Two", "One");
    const logLength = store.log.length;

    const bar = barState(workflow.flow, workflow.registry, store, "first");

    // The session looks at "first" — a view writes nothing, so "first" is still done.
    expect(store.log.length).toBe(logLength);
    expect(bar.current).toEqual({ id: "first", label: "First", state: "done" });
    // The tail keeps its work — a view discards nothing, so "second" is still done.
    expect(bar.next).toEqual({ id: "second", label: "Second", state: "done" });
    // `complete` reads the *frontier*, not where the session looks: every node is done, so the model is whole
    // even though the session is looking back at it.
    expect(bar.complete).toBe(true);
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
