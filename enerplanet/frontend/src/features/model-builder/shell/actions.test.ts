/**
 * The bar's actions (`spec/frame.md` §3.1, §6; `spec/core.md` §G) — written failing first.
 *
 * §G's mapping is deliberately thin: the bar calls operations the core already has, so what is worth testing
 * here is the two places the bar must *not* be thin —
 *
 * 1. **movement is a pure position move, not an undo.** A prior click seals a `jump` with an **empty
 *    cascade**: it rests the session on the node it lands on and **discards nothing**, so no redo tail is ever
 *    produced. The cases below pin that a move prunes not a single port *and marks nothing stale* —
 *    invalidation is by *influence* (T7) when a node runs, never by how far the bar moved — and that it refuses
 *    to move *forward*, because forward is `Continue` running the node.
 * 2. **the bar's save is always `incomplete` (§6).** Finishing a model — writing the real `model.json` and
 *    promoting to `draft` — is the save *node*'s job, behind its completeness gate. So the bar's save pins the
 *    status rather than letting completeness derive it, which is exactly the case below that a complete flow
 *    would otherwise get wrong.
 */

import { describe, it, expect } from "vitest";
import { defineModule, type PortKey } from "@model-builder/core";
import { position, nodeStates } from "../core/position";
import { createStore, type Store } from "../core/store";
import { createInvalidator } from "../core/invalidate";
import { JumpNotBackwards } from "../core/errors";
import { portPath, type DiffOp } from "../core/diff";
import type { Flow, ModuleRegistry } from "../core/flow";
import { moveToNode, saveSession } from "./actions";
import { toWorkflow, type Workflow } from "./workflow";
import example from "./fixtures";
import type { BuilderModule } from "./contract";
import type { Artefact, WorkflowRef } from "../core/artefact";
import type { CreateContext, LegacyModelPayload, ModelGateway } from "../save/gateway";

const ENTRIES: readonly BuilderModule[] = [example];

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

const workflowOf = () => toWorkflow(DEFINITION, ENTRIES, SEED);

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
  store.applyTransaction([replace("modelName", SEED_NAME, "One")], [], { node: { id: "first" } });
  store.applyTransaction([replace("modelName", "One", "Two")], [], { node: { id: "second" } });
}

/** The last entry in the log — what a move just sealed. */
function lastSealed(store: Store) {
  return store.log[store.log.length - 1];
}

describe("moving back a node at a time", () => {
  it("a prior click jumps to the target — one transaction, empty cascade, nothing discarded", () => {
    const workflow = workflowOf();
    const store = createStore(workflow.initial);
    completeFlow(store);
    const before = store.log.length;

    const jump = moveToNode(workflow.flow, workflow.registry, store, "first");

    // The assertion that matters is the *move*: the session rests on the target, and one transaction recorded
    // it — a `jump` whose cascade is empty. Nothing was discarded, so no redo tail exists for the bar to walk.
    // The frontier is untouched by the move (both nodes stay done), so `index` is `flow.length`: only the
    // resting place follows the jump.
    expect(position(workflow.flow, workflow.registry, store)).toMatchObject({ index: 2, restingIndex: 0 });
    expect(store.log.length).toBe(before + 1);
    expect(jump.kind).toBe("jump");
    expect(jump.cascade).toEqual([]);
    expect(jump.jump).toEqual({ from: "second", to: "first" });
    expect(store.canRedo).toBe(false);
  });

  it("marks nothing stale — every node keeps its work and its done state", () => {
    const workflow = workflowOf();
    const store = createStore(workflow.initial);
    completeFlow(store);

    moveToNode(workflow.flow, workflow.registry, store, "first");

    // The move discards nothing *and* marks nothing: both nodes stay done. This is the whole point of a position
    // move over an undo — nothing the tail produced is lost, and nothing the target produced is called into
    // question merely because the session looked at it.
    expect(nodeStates(workflow.flow, workflow.registry, store)).toEqual({
      first: "done",
      second: "done",
    });
    expect(store.data.modelName).toBe("Two");
  });

  it("a complete flow sits *past* its last node, so returning to it is a real move back", () => {
    const workflow = workflowOf();
    const store = createStore(workflow.initial);
    completeFlow(store);

    // Worth pinning because it is the opposite of what "the session is at the last node" suggests: the position
    // of a complete flow is `flow.length`, so the last node is genuinely behind it and one move brings the
    // session onto that node. `moveToNode` landing there is correct, not a forward step.
    moveToNode(workflow.flow, workflow.registry, store, "second");

    expect(position(workflow.flow, workflow.registry, store)).toMatchObject({ index: 2, restingIndex: 1 });
    expect(store.canRedo).toBe(false);
  });

  it("never moves forward: a target ahead of the session is refused, writing nothing", () => {
    const workflow = workflowOf();
    const store = createStore(workflow.initial);

    // Going forward is running a node (`Continue`), never declaring the session there, so a jump refuses the
    // target before anything is sealed. The bar only ever offers targets that are behind, so this is a guard.
    expect(() => moveToNode(workflow.flow, workflow.registry, store, "second")).toThrow(JumpNotBackwards);
    expect(store.log).toHaveLength(0);
  });

  it("refuses a node that is not in this flow", () => {
    const workflow = workflowOf();
    const store = createStore(workflow.initial);

    expect(() => moveToNode(workflow.flow, workflow.registry, store, "nope")).toThrow(/no node "nope"/);
  });
});

/**
 * The worked case from `spec/core.md` §G, at the shell's boundary: `A → B → C → D` with B requiring A and D
 * requiring B, and C writing a port nothing reads. A move discards nothing; a *change* invalidates by
 * influence. So changing A leaves B and D stale while **C is untouched** — the closure never reaches C — and
 * that must survive the movement change, which is the reason these cases exist.
 */
describe("a move discards nothing; a change invalidates by influence", () => {
  /** A drawn ring, in the store's coordinate type — and two more, to stand in for A changing its value. */
  const AREA_0: [number, number][][] = [[[9.7, 50.5], [9.71, 50.5], [9.71, 50.51]]];
  const AREA_1: [number, number][][] = [[[9.8, 50.6], [9.81, 50.6], [9.81, 50.61]]];
  const AREA_2: [number, number][][] = [[[9.9, 50.7], [9.91, 50.7], [9.91, 50.71]]];

  /**
   * One node's module: an entry that writes its port and requires nothing, or a link that requires an input
   * and declares the honest `affect` edge (`input → output`). The edge is what T7's closure walks, so it is
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

  /** A session over the chain, with the real invalidator wired in — a seal's cascade is influence (T7). */
  function chainSession(): { workflow: Workflow; store: Store; flow: Flow; registry: ModuleRegistry } {
    const workflow = toWorkflow(CHAIN_DEFINITION, CHAIN, { coordinates: AREA_0 });
    const store = createStore(workflow.initial, {
      deriveCascade: createInvalidator(workflow.flow, workflow.registry),
    });
    return { workflow, store, flow: workflow.flow, registry: workflow.registry };
  }

  /** Every node has run: each wrote its own port, so the flow reads complete. */
  function runChain(store: Store): void {
    store.applyTransaction([replace("coordinates", AREA_0, AREA_1)], [], { node: { id: "a" } });
    store.applyTransaction([add("buildings", { type: "FeatureCollection", features: [] })], [], {
      node: { id: "b" },
    });
    store.applyTransaction([add("advancedParams", { note: "g1" })], [], { node: { id: "c" } });
    store.applyTransaction([add("technologies", { electricity: [] })], [], { node: { id: "d" } });
  }

  // ── the acceptance case: A → B → C → D → E → F ──────────────────────────────
  //
  // A change at **B** invalidates D and F by influence, so movement must be bounded by the first node that is
  // not done — **D** — and not reach E or F, however far down the flow they sit; once D is done again, F is
  // reachable. A move to B first, being a pure position move, marks nothing stale.

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

  /** A six-node session with the real invalidator wired in, so a seal's cascade is influence (T7). */
  function sixSession(): { store: Store; flow: Flow; registry: ModuleRegistry } {
    const workflow = toWorkflow(SIX_DEFINITION, SIX, { coordinates: AREA_0 });
    const store = createStore(workflow.initial, {
      deriveCascade: createInvalidator(workflow.flow, workflow.registry),
    });
    return { store, flow: workflow.flow, registry: workflow.registry };
  }

  /** Every node has run: each wrote its own port, so the flow reads complete. */
  function runSix(store: Store): void {
    store.applyTransaction([replace("coordinates", AREA_0, AREA_1)], [], { node: { id: "a" } });
    store.applyTransaction([add("buildings", BUILDINGS_1)], [], { node: { id: "b" } });
    store.applyTransaction([add("advancedParams", { note: "g1" })], [], { node: { id: "c" } });
    store.applyTransaction([add("technologies", { electricity: [] })], [], { node: { id: "d" } });
    store.applyTransaction([add("transformers", BUILDINGS_1)], [], { node: { id: "e" } });
    store.applyTransaction([add("saveResult", { modelId: 1, created: true })], [], { node: { id: "f" } });
  }

  it("the acceptance case: at B, a change bounds movement to D — not E or F — until D is done again", () => {
    const { store, flow, registry } = sixSession();
    runSix(store);

    // Move to B: a pure position move. It marks nothing stale — every node stays done — and the session rests on
    // B while the frontier stays past the whole flow (a move cannot move the frontier).
    moveToNode(flow, registry, store, "b");
    expect(position(flow, registry, store)).toMatchObject({ index: 6, restingIndex: 1 });
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
      node: { id: "b" },
    });
    expect(nodeStates(flow, registry, store)).toEqual({
      a: "done",
      b: "done",
      c: "done",
      d: "stale",
      e: "done",
      f: "stale",
    });

    // The frontier is now D — the first node that is not done — so movement reaches D and nothing past it: E and
    // F are both refused, however far down the flow they sit.
    expect(position(flow, registry, store).index).toBe(3);
    expect(() => moveToNode(flow, registry, store, "d")).not.toThrow();
    expect(() => moveToNode(flow, registry, store, "e")).toThrow(JumpNotBackwards);
    expect(() => moveToNode(flow, registry, store, "f")).toThrow(JumpNotBackwards);

    // D is marked done again — it re-derives its output, resolving F's requirement — and F becomes reachable.
    store.applyTransaction([add("technologies", { electricity: [] })], [], { node: { id: "d" } });
    expect(position(flow, registry, store).index).toBe(5);
    expect(() => moveToNode(flow, registry, store, "f")).not.toThrow();
  });

  it("a move prunes nothing and marks nothing stale — every node keeps its data and its done state", () => {
    const { store, flow, registry } = chainSession();
    runChain(store);

    moveToNode(flow, registry, store, "a");

    // The move seals one empty-cascade jump: all four ports are still there, and every node is still done —
    // nothing a move does makes a node stale.
    expect(lastSealed(store).cascade).toEqual([]);
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

    // A change, not a move: the cascade is *omitted*, so T7 derives it from A's `affect` closure — coordinates
    // reaches buildings (B's edge) and technologies (D's edge), but never advancedParams, because nothing
    // declares an edge to it.
    store.applyTransaction([replace("coordinates", AREA_1, AREA_2)], undefined, { node: { id: "a" } });

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
