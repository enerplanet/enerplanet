/**
 * The bar's actions — written failing first.
 *
 * The mapping is deliberately thin: the bar calls operations the core already has, so what is worth testing
 * here is the two places the bar must *not* be thin —
 *
 * 1. **movement is a view, not a commit** (§4). There is no `jump`: "step back to look at something" sets the
 *    viewed placement and writes **nothing**, so no redo tail is ever produced. The cases below pin that a
 *    view prunes not a single port *and marks nothing stale* — invalidation is by *influence* when a node runs,
 *    never by where the session looked — and that the reachable set stops at the frontier.
 * 2. **the bar's save is always `incomplete`.** Finishing a model — writing the real `model.json` and
 *    promoting to `draft` — is the save *node*'s job, behind its completeness gate. So the bar's save pins the
 *    status rather than letting completeness derive it, which is exactly the case below that a complete flow
 *    would otherwise get wrong.
 */

import { describe, it, expect } from "vitest";
import { defineModule, type PortKey } from "@model-builder/core";
import { position, nodeStates } from "../core/position";
import { createStore, type Store } from "../core/store";
import { createInvalidator } from "../core/invalidate";
import { portPath, type DiffOp } from "../core/diff";
import type { Flow, ModuleRegistry } from "../core/flow";
import { barState } from "./barState";
import { stepsState } from "./stepsState";
import { saveSession } from "./actions";
import { toWorkflow, type Workflow } from "./workflow";
import example from "./fixtures";
import type { BuilderModule } from "./contract";
import type { Artefact, WorkflowRef } from "../core/artefact";
import type { CreateContext, LegacyModelPayload, ModelGateway } from "../save/gateway";

const ENTRIES: readonly BuilderModule[] = [example];

/** None of these documents composes a subflow, so the lookup resolves nothing. */
const noSubflows = () => undefined;

/** A drawn ring, in the store's coordinate type (GeoJSON positions, not bare numbers). */
const AREA: [number, number][][] = [[[9.7, 50.5], [9.71, 50.5], [9.71, 50.51]]];

/** The seed satisfies both the fixture's run and the save's refusal check (name, dates, area). */
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

const workflowOf = () => toWorkflow(DEFINITION, ENTRIES, noSubflows, SEED);

const WORKFLOW_REF: WorkflowRef = { id: "steps", version: 1 };

function replace(port: PortKey, prev: unknown, next: unknown): DiffOp {
  return { op: "replace", path: portPath(port), prev, next };
}

/** An addition — a port the store did not hold, then did. */
function add(port: PortKey, next: unknown): DiffOp {
  return { op: "replace", path: portPath(port), prev: undefined, next };
}

/** Seal one transaction per node, so the flow reads complete without running a module. */
function completeFlow(store: Store): void {
  store.applyTransaction([replace("modelName", SEED_NAME, "One")], [], {
    node: { id: "first", moduleId: example.module.id },
  });
  store.applyTransaction([replace("modelName", "One", "Two")], [], {
    node: { id: "second", moduleId: example.module.id },
  });
}

describe("looking back at an earlier node — a view, not a commit", () => {
  it("a prior look selects the target and seals nothing", () => {
    const workflow = workflowOf();
    const store = createStore(workflow.initial);
    completeFlow(store);
    const before = store.log.length;

    const bar = barState(workflow.flow, workflow.registry, store, "first");

    // The assertion that matters is that a *view* writes nothing: the log is unchanged, the frontier is past
    // the whole flow (both nodes stay done), and only where the session looks follows the selection. There is
    // no jump transaction and therefore no redo tail for the bar to walk.
    expect(position(workflow.flow, workflow.registry, store)).toMatchObject({ index: 2, complete: true });
    expect(store.log.length).toBe(before);
    expect(bar.current).toEqual({ id: "first", label: "First", state: "done" });
    expect(store.canRedo).toBe(false);
  });

  it("marks nothing stale — every node keeps its work and its done state", () => {
    const workflow = workflowOf();
    const store = createStore(workflow.initial);
    completeFlow(store);

    barState(workflow.flow, workflow.registry, store, "first");

    // A view discards nothing *and* marks nothing: both nodes stay done. This is the whole point of a view over
    // an undo — nothing the tail produced is lost, and nothing the target produced is called into question
    // merely because the session looked at it.
    expect(nodeStates(workflow.flow, workflow.registry, store)).toEqual({
      first: "done",
      second: "done",
    });
    expect(store.data.modelName).toBe("Two");
  });

  it("a complete flow sits *past* its last node, so looking at it is a real selection back", () => {
    const workflow = workflowOf();
    const store = createStore(workflow.initial);
    completeFlow(store);

    // Worth pinning because it is the opposite of what "the session is at the last node" suggests: the position
    // of a complete flow is `flow.length`, so the last node is genuinely behind the frontier and reachable.
    expect(position(workflow.flow, workflow.registry, store)).toMatchObject({ index: 2, complete: true });
    const steps = stepsState(workflow.flow, workflow.registry, store);
    expect(steps.map((step) => step.movable)).toEqual([true, true]);
  });

  it("the reachable set stops at the frontier — a step past it is not a control", () => {
    const workflow = workflowOf();
    const store = createStore(workflow.initial);

    // Nothing has run: the frontier is the first node, so the first is where the session looks (not a control)
    // and the second is past the frontier (not reachable) — there is nowhere to move.
    expect(stepsState(workflow.flow, workflow.registry, store).map((step) => step.movable)).toEqual([
      false,
      false,
    ]);

    // The first runs: the session looks at the second (the frontier), and the first becomes reachable.
    store.applyTransaction([replace("modelName", SEED_NAME, "One")], [], {
      node: { id: "first", moduleId: example.module.id },
    });
    expect(stepsState(workflow.flow, workflow.registry, store).map((step) => step.movable)).toEqual([
      true,
      false,
    ]);
  });
});

/**
 * The worked case, at the shell's boundary: `A → B → C → D` with B requiring A and D
 * requiring B, and C writing a port nothing reads. A view writes nothing; a *change* invalidates by
 * influence. So changing A leaves B and D stale while **C is untouched** — the closure never reaches C — and
 * that must survive the movement change, which is the reason these cases exist.
 */
describe("a view writes nothing; a change invalidates by influence", () => {
  /** A drawn ring, in the store's coordinate type — and two more, to stand in for A changing its value. */
  const AREA_0: [number, number][][] = [[[9.7, 50.5], [9.71, 50.5], [9.71, 50.51]]];
  const AREA_1: [number, number][][] = [[[9.8, 50.6], [9.81, 50.6], [9.81, 50.61]]];
  const AREA_2: [number, number][][] = [[[9.9, 50.7], [9.91, 50.7], [9.91, 50.71]]];

  /**
   * One node's module: an entry that writes its port and requires nothing, or a link that requires an input
   * and declares the honest `affect` edge (`input → output`). The edge is what the closure walks, so it is
   * what makes B and D reachable from A and C not.
   */
  function influenceModule(id: string, writes: PortKey, reads?: PortKey): BuilderModule {
    return {
      module: defineModule({
        id,
        params: [
          ...(reads === undefined ? [] : [{ port: reads, required: true }]),
          { port: writes },
        ],
        affect: reads === undefined ? {} : { [reads]: [writes] },
        layout: [],
        run: () => undefined,
        validate: () => [],
      }),
      Component: () => null,
      mock: {},
    };
  }

  const CHAIN: readonly BuilderModule[] = [
    influenceModule("src", "coordinates"), // A — writes coordinates
    influenceModule("beta", "buildings", "coordinates"), // B — requires coordinates, writes buildings
    influenceModule("clean", "advancedParams"), // C — writes advancedParams, nothing reads it
    influenceModule("delta", "technologies", "buildings"), // D — requires buildings, writes technologies
  ];

  const CHAIN_DEFINITION = {
    id: "chain",
    label: "Chain",
    seed: "testdata/dev-flow.json",
    nodes: [
      { id: "a", moduleId: "src" },
      { id: "b", moduleId: "beta" },
      { id: "c", moduleId: "clean" },
      { id: "d", moduleId: "delta" },
    ],
  };

  /** A session over the chain, with the real invalidator wired in — a seal's cascade is influence. */
  function chainSession(): { workflow: Workflow; store: Store; flow: Flow; registry: ModuleRegistry } {
    const workflow = toWorkflow(CHAIN_DEFINITION, CHAIN, noSubflows, { coordinates: AREA_0 });
    const store = createStore(workflow.initial, {
      deriveCascade: createInvalidator(workflow.flow, workflow.registry),
    });
    return { workflow, store, flow: workflow.flow, registry: workflow.registry };
  }

  /** Every node has run: each wrote its own port, so the flow reads complete. */
  function runChain(store: Store): void {
    store.applyTransaction([replace("coordinates", AREA_0, AREA_1)], [], {
      node: { id: "a", moduleId: "src" },
    });
    store.applyTransaction([add("buildings", { type: "FeatureCollection", features: [] })], [], {
      node: { id: "b", moduleId: "beta" },
    });
    store.applyTransaction([add("advancedParams", { note: "g1" })], [], {
      node: { id: "c", moduleId: "clean" },
    });
    store.applyTransaction([add("technologies", { electricity: [] })], [], {
      node: { id: "d", moduleId: "delta" },
    });
  }

  // ── the acceptance case: A → B → C → D → E → F ──────────────────────────────
  //
  // A change at **B** invalidates D and F by influence, so the reachable set is bounded by the first node that
  // is not done — **D** — and does not reach E or F, however far down the flow they sit; once D is done again,
  // F is reachable. Looking at B first, being a view, marks nothing stale.

  const SIX: readonly BuilderModule[] = [
    influenceModule("src", "coordinates"), // A — writes coordinates
    influenceModule("beta", "buildings", "coordinates"), // B — requires coordinates, writes buildings
    influenceModule("clean", "advancedParams"), // C — writes advancedParams, nothing reads it
    influenceModule("delta", "technologies", "buildings"), // D — requires buildings, writes technologies
    influenceModule("extra", "transformers"), // E — writes transformers, nothing reads it
    influenceModule("final", "saveResult", "technologies"), // F — requires technologies, writes saveResult
  ];

  const SIX_DEFINITION = {
    id: "chain-six",
    label: "Chain of six",
    // The dev-flow seed the other definitions name, referenced from `DEFINITION` rather than spelled a third
    // time (which would trip the duplicate-string lint).
    seed: DEFINITION.seed,
    nodes: [
      { id: "a", moduleId: "src" },
      { id: "b", moduleId: "beta" },
      { id: "c", moduleId: "clean" },
      { id: "d", moduleId: "delta" },
      { id: "e", moduleId: "extra" },
      { id: "f", moduleId: "final" },
    ],
  };

  const BUILDINGS_1 = { type: "FeatureCollection", features: [] };
  const BUILDINGS_2 = { type: "FeatureCollection", features: [{ id: "b1" }] };

  /** A six-node session with the real invalidator wired in, so a seal's cascade is influence. */
  function sixSession(): { store: Store; flow: Flow; registry: ModuleRegistry } {
    const workflow = toWorkflow(SIX_DEFINITION, SIX, noSubflows, { coordinates: AREA_0 });
    const store = createStore(workflow.initial, {
      deriveCascade: createInvalidator(workflow.flow, workflow.registry),
    });
    return { store, flow: workflow.flow, registry: workflow.registry };
  }

  /** Every node has run: each wrote its own port, so the flow reads complete. */
  function runSix(store: Store): void {
    store.applyTransaction([replace("coordinates", AREA_0, AREA_1)], [], { node: { id: "a", moduleId: "src" } });
    store.applyTransaction([add("buildings", BUILDINGS_1)], [], { node: { id: "b", moduleId: "beta" } });
    store.applyTransaction([add("advancedParams", { note: "g1" })], [], { node: { id: "c", moduleId: "clean" } });
    store.applyTransaction([add("technologies", { electricity: [] })], [], { node: { id: "d", moduleId: "delta" } });
    store.applyTransaction([add("transformers", BUILDINGS_1)], [], { node: { id: "e", moduleId: "extra" } });
    store.applyTransaction([add("saveResult", { modelId: 1, created: true })], [], {
      node: { id: "f", moduleId: "final" },
    });
  }

  it("the acceptance case: at B, a change bounds the reachable set to D — not E or F — until D is done again", () => {
    const { store, flow, registry } = sixSession();
    runSix(store);

    // Look at B: a view (§4). It writes nothing — every node stays done — and the frontier is past the whole
    // flow, so looking at B cannot move it.
    expect(position(flow, registry, store)).toMatchObject({ index: 6, complete: true });
    expect(nodeStates(flow, registry, store)).toEqual({
      a: "done",
      b: "done",
      c: "done",
      d: "done",
      e: "done",
      f: "done",
    });

    // B then commits a change: `buildings` affects `technologies` (D) and, through it, `saveResult` (F) — never
    // `advancedParams` (C) or `transformers` (E). So D and F go stale, and C and E are untouched.
    store.applyTransaction([replace("buildings", BUILDINGS_1, BUILDINGS_2)], undefined, {
      node: { id: "b", moduleId: "beta" },
    });
    expect(nodeStates(flow, registry, store)).toEqual({
      a: "done",
      b: "done",
      c: "done",
      d: "stale",
      e: "done",
      f: "stale",
    });

    // The frontier is now D — the first node that is not done — so the reachable set from B stops there: E and
    // F are not controls, however far down the flow they sit.
    expect(position(flow, registry, store).index).toBe(3);
    expect(stepsState(flow, registry, store, "b").map((step) => step.movable)).toEqual([
      true, // a
      false, // b (where the session looks)
      true, // c
      true, // d (the frontier, inclusive)
      false, // e
      false, // f
    ]);

    // D is marked done again — it re-derives its output, resolving F's requirement — and F becomes reachable.
    store.applyTransaction([add("technologies", { electricity: [] })], [], {
      node: { id: "d", moduleId: "delta" },
    });
    expect(position(flow, registry, store).index).toBe(5);
    expect(stepsState(flow, registry, store, "b")[5].movable).toBe(true); // f
  });

  it("a view prunes nothing and marks nothing stale — every node keeps its data and its done state", () => {
    const { store, flow, registry } = chainSession();
    runChain(store);
    const before = store.log.length;

    // Look at A: a view writes nothing, so all four ports are still there, every node is still done, and the
    // log did not grow — nothing a view does makes a node stale.
    barState(flow, registry, store, "a");
    expect(store.log.length).toBe(before);
    expect(nodeStates(flow, registry, store)).toEqual({
      a: "done",
      b: "done",
      c: "done",
      d: "done",
    });
    expect(store.data.buildings).toBeDefined();
    expect(store.data.advancedParams).toEqual({ note: "g1" });
    expect(store.data.technologies).toEqual({ electricity: [] });
  });

  it("changing A makes B and D stale while C is untouched — invalidation is by influence, not position", () => {
    const { store, flow, registry } = chainSession();
    runChain(store);

    // A change, not a view: the cascade is *omitted*, so it derives from A's `affect` closure — coordinates
    // reaches buildings (B's edge) and technologies (D's edge), but never advancedParams, because nothing
    // declares an edge to it.
    store.applyTransaction([replace("coordinates", AREA_1, AREA_2)], undefined, {
      node: { id: "a", moduleId: "src" },
    });

    expect(nodeStates(flow, registry, store)).toEqual({
      a: "done",
      b: "stale",
      c: "done",
      d: "stale",
    });
    expect(store.data.advancedParams).toEqual({ note: "g1" }); // C unaffected — the closure never reaches it
    expect(store.data.buildings).toBeUndefined(); // B's output pruned
    expect(store.data.technologies).toBeUndefined(); // D's output pruned
  });
});

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
