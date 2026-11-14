/**
 * The steps panel's state — the whole workflow in order (`spec/frame.md` §3.3).
 *
 * The panel answers a different question from the bar: not "where am I" but "what is the state of every step",
 * which is why it is a derivation of its own rather than a wider reading of `barState`. Everything comes from
 * `positionReport` — done / stale / pending per node, plus what a node wrote that is gone and which required
 * ports are missing *right now* — with one addition: which node the session sits on, because the panel marks it
 * and `positionReport` has no reason to.
 *
 * `blocked` and `pruned` are carried through on purpose: they are the *reason* behind a step that is not done,
 * and a panel that showed the colour without the reason would be telling the user something is wrong without
 * saying what.
 *
 * Written failing first.
 */
import { describe, it, expect } from "vitest";
import { defineModule } from "@model-builder/core";
import { stepsState } from "./stepsState";
import { toWorkflow } from "./workflow";
import { portPath, type DiffOp } from "../core/diff";
import { createStore } from "../core/store";
import example from "../modules/example";
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

/** The seed's name, padded so the example module's `run()` produces a real diff — it trims. */
const SEED_NAME = "  Steps fixture  ";

const SEED = { modelName: SEED_NAME, resolution: 60 };

const TWO_STEPS = {
  id: "steps",
  label: "Two steps",
  seed: "testdata/dev-flow.json",
  nodes: [
    { id: "first", moduleId: example.module.id, label: "First" },
    { id: "second", moduleId: example.module.id, label: "Second" },
  ],
};

const workflowOf = (nodes: unknown) => toWorkflow({ ...TWO_STEPS, nodes }, ENTRIES, SEED);

function replace(port: "modelName", prev: unknown, next: unknown): DiffOp {
  return { op: "replace", path: portPath(port), prev, next };
}

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
    const { createEngine } = await import("../core/engine");
    await createEngine(store).runModule(example.module, { id: "first" });

    const steps = stepsState(workflow.flow, workflow.registry, store);

    expect(steps.map((step) => step.state)).toEqual(["done", "pending"]);
    expect(steps.map((step) => step.current)).toEqual([false, true]);
  });

  it("with the flow complete: everything done, and nothing is current", () => {
    const workflow = workflowOf(TWO_STEPS.nodes);
    const store = createStore(workflow.initial);
    store.applyTransaction([replace("modelName", SEED_NAME, "One")], [], {
      node: { id: "first" },
    });
    store.applyTransaction([replace("modelName", "One", "Two")], [], { node: { id: "second" } });

    const steps = stepsState(workflow.flow, workflow.registry, store);

    expect(steps.map((step) => step.state)).toEqual(["done", "done"]);
    // There is no "first node that is not done", so no step is the current one — unlike the bar, which names
    // the last step so it has something to show. Be precise about the mechanism: what guarantees this is
    // `position()` reporting `index = flow.length` for a complete flow, not the guard in `stepsState`.
    expect(steps.some((step) => step.current)).toBe(false);
  });

  it("a step the session jumped back to is stale, and current", () => {
    const workflow = workflowOf(TWO_STEPS.nodes);
    const store = createStore(workflow.initial);
    store.applyTransaction([replace("modelName", SEED_NAME, "One")], [], {
      node: { id: "first" },
    });
    store.applyTransaction([], [], {
      node: { id: "first" },
      kind: "jump",
      jump: { from: "second", to: "first" },
    });

    const steps = stepsState(workflow.flow, workflow.registry, store);

    expect(steps[0].state).toBe("stale");
    expect(steps[0].current).toBe(true);
  });

  it("carries the reason: the ports a stale step wrote that are gone", () => {
    const workflow = workflowOf(TWO_STEPS.nodes);
    const store = createStore(workflow.initial);
    store.applyTransaction([replace("modelName", SEED_NAME, "One")], [], {
      node: { id: "first" },
    });
    // A jump whose cascade removes what the first step wrote: its work is gone, so it is stale because of it.
    store.applyTransaction([], [{ op: "remove", path: portPath("modelName"), prev: "One" }], {
      node: { id: "first" },
      kind: "jump",
      jump: { from: "first", to: "first" },
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
