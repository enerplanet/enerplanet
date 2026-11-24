/**
 * The steps panel's state — every step's state from `positionReport`, plus which node the session is
 * looking at.
 */
import { describe, it, expect } from "vitest";
import { defineModule } from "@model-builder/core";
import { stepsState } from "./stepsState";
import { toWorkflow } from "./workflow";
import { portPath, type DiffOp } from "../core/diff";
import { createStore } from "../core/store";
import example, { hold } from "./fixtures";
import type { BuilderModule } from "./contract";

/** Needs a port nothing in this workflow produces — the case `blocked` exists for. */
const NEEDS_TRANSFORMERS: BuilderModule = {
  module: defineModule({
    id: "needs-transformers",
    params: [{ port: "transformers", required: true }],
    affect: {},
    layout: [],
    run: () => undefined,
    validate: () => [],
  }),
  Component: () => null,
  mock: {},
};

const ENTRIES: readonly BuilderModule[] = [example, NEEDS_TRANSFORMERS];

/** The seed's name, padded so the fixture's `run()` produces a real diff — it trims. */
const SEED_NAME = "  Steps fixture  ";

const SEED = { modelName: SEED_NAME, resolution: 60 };

/** None of these documents composes a subflow, so the lookup resolves nothing. */
const noSubflows = () => undefined;

const TWO_STEPS = {
  id: "steps",
  label: "Two steps",
  seed: "testdata/dev-flow.json",
  nodes: [
    { id: "first", moduleId: example.module.id, label: "First" },
    { id: "second", moduleId: example.module.id, label: "Second" },
  ],
};

const workflowOf = (nodes: unknown) => toWorkflow({ ...TWO_STEPS, nodes }, ENTRIES, noSubflows, SEED);

function replace(port: "modelName", prev: unknown, next: unknown): DiffOp {
  return { op: "replace", path: portPath(port), prev, next };
}

/** The node ref a seal carries: the placement id and the module that produced it. */
const ref = (id: string) => ({ id, moduleId: example.module.id });

describe("the steps panel reads the whole workflow", () => {
  it("before anything runs: every step pending, the first one current", () => {
    const workflow = workflowOf(TWO_STEPS.nodes);

    const steps = stepsState(workflow.flow, workflow.registry, createStore(workflow.initial));

    expect(steps.map((step) => step.state)).toEqual(["pending", "pending"]);
    expect(steps.map((step) => step.current)).toEqual([true, false]);
    expect(steps.map((step) => step.label)).toEqual(["First", "Second"]);
  });

  it("after the first step runs: it is done, and the second takes over as current", async () => {
    const workflow = workflowOf(TWO_STEPS.nodes);
    const store = createStore(workflow.initial);
    // The fixture takes the values its regions collect through `hold()` (see the note on it), so a test that
    // wants a real transaction fills them the way a region does — a bare run commits nothing by design.
    hold("first", { modelName: "  Steps fixture  " });
    const { createEngine } = await import("../core/engine");
    await createEngine(store).runModule(example.module, { id: "first", moduleId: example.module.id });

    const steps = stepsState(workflow.flow, workflow.registry, store);

    expect(steps.map((step) => step.state)).toEqual(["done", "pending"]);
    expect(steps.map((step) => step.current)).toEqual([false, true]);
  });

  it("with the flow complete: everything done, and nothing is current", () => {
    const workflow = workflowOf(TWO_STEPS.nodes);
    const store = createStore(workflow.initial);
    store.applyTransaction([replace("modelName", SEED_NAME, "One")], [], { node: ref("first") });
    store.applyTransaction([replace("modelName", "One", "Two")], [], { node: ref("second") });

    const steps = stepsState(workflow.flow, workflow.registry, store);

    expect(steps.map((step) => step.state)).toEqual(["done", "done"]);
    // There is no "first node that is not done", so no step is the current one — unlike the bar, which names
    // the last step so it has something to show. Be precise about the mechanism: what guarantees this is
    // `position()` reporting `index = flow.length` for a complete flow, not the guard in `stepsState`.
    expect(steps.some((step) => step.current)).toBe(false);
  });

  it("a step the session looks back at stays done, and is current", () => {
    const workflow = workflowOf(TWO_STEPS.nodes);
    const store = createStore(workflow.initial);
    store.applyTransaction([replace("modelName", SEED_NAME, "One")], [], { node: ref("first") });

    // A view is read-only: looking back at "first" writes nothing, so it stays done.
    const steps = stepsState(workflow.flow, workflow.registry, store, "first");

    expect(steps[0].state).toBe("done");
    expect(steps[0].current).toBe(true);
  });

  it("marks exactly the steps a click can move to — the reachable set, frontier included", () => {
    const workflow = workflowOf(TWO_STEPS.nodes);

    // Nothing has run: the session looks at the first step and the frontier is there too, so there is nowhere
    // to move — the viewed step is not a control, because clicking it would move nothing.
    const atStart = stepsState(workflow.flow, workflow.registry, createStore(workflow.initial));
    expect(atStart.map((step) => step.movable)).toEqual([false, false]);

    const store = createStore(workflow.initial);
    store.applyTransaction([replace("modelName", SEED_NAME, "One")], [], { node: ref("first") });

    // The first has run, so the session looks at the second (the frontier): the first is reachable and the
    // second is not, since it is where the session already is.
    const atSecond = stepsState(workflow.flow, workflow.registry, store);
    expect(atSecond.map((step) => step.movable)).toEqual([true, false]);
    expect(atSecond.map((step) => step.current)).toEqual([false, true]);

    // Now look back at the first. The frontier stays ahead at the second — it is `pending`, and a view writes
    // nothing, so it stays that way — and the second is therefore **reachable from here**. This is the case the
    // inclusive frontier exists for: movement may go as far as the first node that is not done, because past it
    // the values would be read across a broken link.
    const movedBack = stepsState(workflow.flow, workflow.registry, store, "first");
    expect(movedBack.map((step) => step.current)).toEqual([true, false]);
    expect(movedBack.map((step) => step.movable)).toEqual([false, true]);

    store.applyTransaction([replace("modelName", "One", "Two")], [], { node: ref("second") });

    // Complete: the frontier is `flow.length`, so every step is reachable and none is current (no view set).
    const done = stepsState(workflow.flow, workflow.registry, store);
    expect(done.map((step) => step.movable)).toEqual([true, true]);
    expect(done.some((step) => step.current)).toBe(false);
  });

  it("carries the reason: the ports a stale step wrote that are gone", () => {
    const workflow = workflowOf(TWO_STEPS.nodes);
    const store = createStore(workflow.initial);
    store.applyTransaction([replace("modelName", SEED_NAME, "One")], [], { node: ref("first") });
    // A change whose cascade removes what the first step wrote: its work is gone, so it is stale because of it.
    store.applyTransaction([], [{ op: "remove", path: portPath("modelName"), prev: "One" }], {
      node: ref("first"),
    });

    const steps = stepsState(workflow.flow, workflow.registry, store);

    expect(steps[0].state).toBe("stale");
    expect(steps[0].pruned).toEqual(["modelName"]);
  });

  it("carries the reason a step cannot run here: required ports nothing provides", () => {
    const workflow = workflowOf([
      { id: "first", moduleId: example.module.id, label: "First" },
      { id: "second", moduleId: "needs-transformers", label: "Second" },
    ]);

    const steps = stepsState(workflow.flow, workflow.registry, createStore(workflow.initial));

    expect(steps[1].blocked).toEqual(["transformers"]);
    expect(steps[0].blocked).toEqual([]);
  });

  it("falls back to the module id when a step has no label", () => {
    const workflow = workflowOf([{ id: "only", moduleId: example.module.id }]);

    const steps = stepsState(workflow.flow, workflow.registry, createStore(workflow.initial));

    expect(steps[0].label).toBe(example.module.id);
  });
});
