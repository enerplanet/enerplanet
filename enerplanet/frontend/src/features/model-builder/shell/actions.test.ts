/**
 * The bar's actions (`spec/frame.md` §3.1, §6) — written failing first.
 *
 * §3.1's mapping is deliberately thin: the bar calls operations the core already has, so what is worth testing
 * here is the two places the bar must *not* be thin —
 *
 * 1. **forward movement is redo-to-tip, never a jump.** A jump refuses a forward target by design
 *    (`JumpNotBackwards`), so the forward control must walk the tail. `jumpBack` exists to make that rule a
 *    named thing with a test on it, rather than a comment next to a button.
 * 2. **the bar's save is always `incomplete` (§6).** Finishing a model — writing the real `model.json` and
 *    promoting to `draft` — is the save *node*'s job, behind its completeness gate. So the bar's save pins the
 *    status rather than letting completeness derive it, which is exactly the case below that a complete flow
 *    would otherwise get wrong.
 */

import { describe, it, expect } from "vitest";
import { defineModule } from "@model-builder/core";
import { position } from "../core/position";
import { createStore, type Store } from "../core/store";
import { portPath, type DiffOp } from "../core/diff";
import { redoToTip, undoToNode, saveSession } from "./actions";
import { toWorkflow } from "./workflow";
import example from "../modules/example";
import type { BuilderModule } from "./contract";
import type { Artefact, WorkflowRef } from "../core/artefact";
import type { CreateContext, LegacyModelPayload, ModelGateway } from "../save/gateway";

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

/** A drawn ring, in the store's coordinate type (GeoJSON positions, not bare numbers). */
const AREA: [number, number][][] = [[[9.7, 50.5], [9.71, 50.5], [9.71, 50.51]]];

/** The seed satisfies both the example module's run and the save's refusal check (name, dates, area). */
const SEED_NAME = "  Actions fixture  ";
const SEED = {
  modelName: SEED_NAME,
  resolution: 60,
  fromDate: "2026-01-01",
  toDate: "2026-12-31",
  coordinates: AREA,
};

const DEFINITION = {
  id: "steps",
  label: "Two steps",
  seed: "testdata/dev-flow.json",
  nodes: [
    { id: "first", moduleId: example.module.id, label: "First" },
    { id: "second", moduleId: example.module.id, label: "Second" },
  ],
};

const workflowOf = () => toWorkflow(DEFINITION, ENTRIES, SEED);

const WORKFLOW_REF: WorkflowRef = { id: "steps", version: 1 };

function replace(port: "modelName", prev: unknown, next: unknown): DiffOp {
  return { op: "replace", path: portPath(port), prev, next };
}

/** Seal one transaction per node, so the flow reads complete without running a module. */
function completeFlow(store: Store): void {
  store.applyTransaction([replace("modelName", SEED_NAME, "One")], [], { node: { id: "first" } });
  store.applyTransaction([replace("modelName", "One", "Two")], [], { node: { id: "second" } });
}

interface Recorded {
  creates: { payload: LegacyModelPayload; context?: CreateContext }[];
  updates: { modelId: number; payload: LegacyModelPayload }[];
  sessions: { modelId: number; artefact: Artefact; workflow: WorkflowRef }[];
}

function recorder(): { gateway: ModelGateway; recorded: Recorded } {
  const recorded: Recorded = { creates: [], updates: [], sessions: [] };

  return {
    recorded,
    gateway: {
      async createModel(payload, context) {
        recorded.creates.push(context === undefined ? { payload } : { payload, context });
        return { modelId: 42 };
      },
      async updateModel(modelId, payload) {
        recorded.updates.push({ modelId, payload });
      },
      async saveSession(modelId, artefact, workflow) {
        recorded.sessions.push({ modelId, artefact, workflow });
      },
      async loadSession() {
        return undefined;
      },
    },
  };
}

describe("redo to the tip", () => {
  it("does nothing when there is no discard tail", () => {
    const workflow = workflowOf();
    const store = createStore(workflow.initial);
    completeFlow(store);
    const logLength = store.log.length;

    const walked = redoToTip(store);

    expect(walked).toBe(0);
    expect(store.log.length).toBe(logLength);
    expect(store.cursor).toBe(logLength);
  });

  it("restores the tip after an undo, walking the whole tail", () => {
    const workflow = workflowOf();
    const store = createStore(workflow.initial);
    completeFlow(store);
    store.undo();
    store.undo();
    expect(position(workflow.flow, workflow.registry, store).complete).toBe(false);

    const walked = redoToTip(store);

    expect(walked).toBe(2);
    expect(store.canRedo).toBe(false);
    expect(position(workflow.flow, workflow.registry, store).complete).toBe(true);
  });

  it("has nothing to redo while the session sits at the tip", () => {
    const workflow = workflowOf();
    const store = createStore(workflow.initial);
    completeFlow(store);
    const logLength = store.log.length;

    // Nothing has moved backwards, so there is no tail — which is why the bar shows the next step as plain
    // greyed text until a prior click creates one.
    expect(store.canRedo).toBe(false);
    expect(redoToTip(store)).toBe(0);
    expect(store.log.length).toBe(logLength);
  });
});

describe("moving back a module at a time", () => {
  it("a prior click unwinds the whole module, not one commit", () => {
    const workflow = workflowOf();
    const store = createStore(workflow.initial);
    // Two commits on the *same* node: a per-commit module seals as the user acts, so a node can own several.
    store.applyTransaction([replace("modelName", SEED_NAME, "One")], [], { node: { id: "first" } });
    store.applyTransaction([replace("modelName", "One", "Two")], [], { node: { id: "first" } });
    store.applyTransaction([replace("modelName", "Two", "Three")], [], { node: { id: "second" } });

    const unwound = undoToNode(workflow.flow, workflow.registry, store, "first");

    // The assertion that matters is the *position*: one gesture puts the session back on "first", which takes
    // more than one undo, where a single atomic undo would leave it at the tip of that node's own commits.
    expect(position(workflow.flow, workflow.registry, store).index).toBe(0);
    expect(unwound).toBeGreaterThan(1);
    expect(store.canRedo).toBe(true);
  });

  it("leaves exactly the tail the forward control walks back to the tip", () => {
    const workflow = workflowOf();
    const store = createStore(workflow.initial);
    completeFlow(store);

    undoToNode(workflow.flow, workflow.registry, store, "first");
    expect(store.canRedo).toBe(true);

    // Step back to look at something, forward to return exactly where you were.
    redoToTip(store);

    expect(store.canRedo).toBe(false);
    expect(position(workflow.flow, workflow.registry, store).complete).toBe(true);
  });

  it("a complete flow sits *past* its last node, so returning to it is a real move back", () => {
    const workflow = workflowOf();
    const store = createStore(workflow.initial);
    completeFlow(store);

    // Worth pinning because it is the opposite of what "the session is at the last node" suggests: the position
    // of a complete flow is `flow.length`, so the last node is genuinely behind it and one undo brings the
    // session onto that node. `undoToNode` moving here is correct, not a forward step.
    expect(undoToNode(workflow.flow, workflow.registry, store, "second")).toBe(1);
    expect(position(workflow.flow, workflow.registry, store).index).toBe(1);
    expect(store.canRedo).toBe(true);
  });

  it("never moves forward: an untouched session is left alone", () => {
    const workflow = workflowOf();
    const store = createStore(workflow.initial);

    // The condition is `position.index > target`, so a target ahead of the session — or the empty session
    // itself — takes no action at all. The bar only ever offers targets that are behind, so this is a guard.
    expect(undoToNode(workflow.flow, workflow.registry, store, "second")).toBe(0);
    expect(position(workflow.flow, workflow.registry, store).index).toBe(0);
    expect(store.log).toHaveLength(0);
  });

  it("refuses a node that is not in this flow", () => {
    const workflow = workflowOf();
    const store = createStore(workflow.initial);

    expect(() => undoToNode(workflow.flow, workflow.registry, store, "nope")).toThrow(/no node "nope"/);
  });
});

describe("the bar's save", () => {
  it("saves an unfinished flow as incomplete, with an empty config and its session", async () => {
    const workflow = workflowOf();
    const store = createStore(workflow.initial);
    const { gateway, recorded } = recorder();

    const outcome = await saveSession(gateway, {
      store,
      flow: workflow.flow,
      registry: workflow.registry,
      workflow: WORKFLOW_REF,
    });

    expect(outcome).toEqual({
      ok: true,
      modelId: 42,
      created: true,
      status: "incomplete",
      historySaved: true,
    });
    expect(recorded.creates[0].payload.status).toBe("incomplete");
    expect(recorded.creates[0].payload.config).toEqual({});
    expect(recorded.sessions).toHaveLength(1);
    expect(recorded.sessions[0].workflow).toEqual(WORKFLOW_REF);
  });

  it("still saves as incomplete on a complete flow — finishing is the save node's job", async () => {
    const workflow = workflowOf();
    const store = createStore(workflow.initial);
    completeFlow(store);
    const { gateway, recorded } = recorder();

    const outcome = await saveSession(gateway, {
      store,
      flow: workflow.flow,
      registry: workflow.registry,
      workflow: WORKFLOW_REF,
    });

    expect(outcome).toMatchObject({ ok: true, status: "incomplete" });
    expect(recorded.creates[0].payload.status).toBe("incomplete");
    // No real config and no promotion to `draft`: the run-ready model is the save node's to write.
    expect(recorded.creates[0].payload.config).toEqual({});
  });

  it("updates rather than creates once the session has a model", async () => {
    const workflow = workflowOf();
    const store = createStore(workflow.initial);
    const { gateway, recorded } = recorder();

    const outcome = await saveSession(gateway, {
      store,
      flow: workflow.flow,
      registry: workflow.registry,
      workflow: WORKFLOW_REF,
      modelId: 7,
    });

    expect(outcome).toMatchObject({ ok: true, modelId: 7, created: false });
    expect(recorded.creates).toHaveLength(0);
    expect(recorded.updates[0].modelId).toBe(7);
  });

  it("sends nothing when the save is refused", async () => {
    const workflow = workflowOf();
    // A model with no name cannot be saved, and the refusal happens before any call is made.
    const store = createStore({ ...workflow.initial, modelName: "   " });
    const { gateway, recorded } = recorder();

    const outcome = await saveSession(gateway, {
      store,
      flow: workflow.flow,
      registry: workflow.registry,
      workflow: WORKFLOW_REF,
    });

    expect(outcome).toEqual({ ok: false, reason: "missing-name" });
    expect(recorded.creates).toHaveLength(0);
    expect(recorded.updates).toHaveLength(0);
    expect(recorded.sessions).toHaveLength(0);
  });
});
