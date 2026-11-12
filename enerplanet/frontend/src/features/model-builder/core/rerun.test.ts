/**
 * Re-run and jump mechanics — case T20 slice C, which is T12's loopback.
 *
 * Spec: `.local/ModularThesis/spec/core.md` §G. A jump moves the session back inside the same
 * immutable flow. It discards **only what a later node uses** — a node overwrites its own params
 * when it runs again, and configuration nothing reads is worth keeping. It also re-arms its
 * target, so a jump that discards nothing (a bare re-save) still moves the position.
 *
 * Written failing first.
 */
import { describe, it, expect } from "vitest";
import { jumpTo, planJump, walkTail } from "./rerun";
import { nodeStates, position } from "./position";
import { JumpNotBackwards } from "./errors";
import type { ModuleRegistry } from "./flow";
import { createEngine } from "./engine";
import { createStore } from "./store";
import { defineModule } from "./module";
import { building, fc, seed } from "./fixtures";
import type { PortKey } from "./ports";

// ── a four-node flow, with two params no later node reads ───────────────────

const REGION: PortKey = "region";
const COORDINATES: PortKey = "coordinates";
const BUILDINGS: PortKey = "buildings";
/** Configuration the tail writes that nothing reads — `grid` must survive a jump keeping it. */
const TRANSFORMERS: PortKey = "transformers";
/** An output nothing consumes — `save`'s, preserved for the same reason. */
const SAVE_RESULT: PortKey = "saveResult";

const start = defineModule({
  id: "start",
  params: [{ port: REGION }],
  affect: {},
  layout: [],
  run: (ctx) => ctx.commit({ region: { country: "DE", state: "BW" } }),
  validate: () => [],
});

const draw = defineModule({
  id: "draw",
  params: [{ port: REGION, required: true }, { port: COORDINATES }],
  affect: { region: [COORDINATES] },
  layout: [],
  run: (ctx) => {
    ctx.read(COORDINATES);
    ctx.commit({ coordinates: [[[8.6, 49.4]]] });
  },
  validate: () => [],
});

const grid = defineModule({
  id: "grid",
  params: [{ port: COORDINATES, required: true }, { port: BUILDINGS }, { port: TRANSFORMERS }],
  affect: { coordinates: [BUILDINGS] },
  layout: [],
  run: (ctx) => {
    // Reads what it is about to overwrite — what anti-clobber demands of any re-run over a value
    // that survived the jump.
    ctx.read(BUILDINGS);
    ctx.read(TRANSFORMERS);
    ctx.commit({ buildings: fc([building("b1")]), transformers: fc([building("t1")]) });
  },
  validate: () => [],
});

const save = defineModule({
  id: "save",
  params: [{ port: BUILDINGS, required: true }, { port: SAVE_RESULT }],
  affect: {},
  layout: [],
  run: (ctx) => ctx.commit({ saveResult: { modelId: 1, created: true } }),
  validate: () => [],
});

const registry: ModuleRegistry = Object.fromEntries(
  [start, draw, grid, save].map((module) => [module.id, module]),
);

const FLOW = [start, draw, grid, save].map((module) => ({ id: module.id, moduleId: module.id }));

async function runAll(store: ReturnType<typeof createStore>): Promise<void> {
  const engine = createEngine(store);
  for (const module of [start, draw, grid, save]) {
    await engine.runModule(module, { id: module.id });
  }
}

// ── T20 (re-run) ────────────────────────────────────────────────────────────

describe("T20c — a jump drops back without throwing the tail away", () => {
  it("prunes only what a later node uses, keeping configuration and unused outputs", async () => {
    const store = createStore(seed());
    await runAll(store);

    const plan = planJump(FLOW, registry, store, "draw");

    // coordinates (written by the target, required by grid) and buildings (required by save)
    expect(plan.cascade.map((op) => op.path)).toEqual(["/coordinates", "/buildings"]);
    // …while the value upstream of the target, the tail's own configuration, and an output
    // nothing consumes are all left alone.
    expect(store.data.region).toBeDefined();
    expect(store.data.transformers).toEqual(fc([building("t1")]));
    expect(store.data.saveResult).toEqual({ modelId: 1, created: true });
    expect(plan).toMatchObject({ index: 1, to: "draw", from: "save" });
  });

  it("discards nothing when the tail needs none of the target's work — and still re-arms it", async () => {
    const store = createStore(seed());
    await runAll(store);

    const transaction = jumpTo(FLOW, registry, store, "save");

    expect(transaction.cascade).toEqual([]); // the one documented zero-diff transaction
    expect(transaction).toMatchObject({ kind: "jump", jump: { from: "save", to: "save" } });
    // Nothing was thrown away, so pruning alone would not move anything: the jump's own entry
    // is what makes this a re-save rather than a no-op.
    expect(position(FLOW, registry, store)).toMatchObject({ index: 3, nodeId: "save" });
    expect(nodeStates(FLOW, registry, store).save).toBe("stale");
  });

  it("refuses a forward jump and writes nothing", async () => {
    const store = createStore(seed());
    const engine = createEngine(store);
    await engine.runModule(start, { id: "start" });
    await engine.runModule(draw, { id: "draw" });
    const before = store.log.length;

    expect(() => jumpTo(FLOW, registry, store, "save")).toThrow(JumpNotBackwards);
    expect(store.log).toHaveLength(before);
  });

  it("undoes a jump like any other transaction, restoring exactly what it discarded", async () => {
    const store = createStore(seed());
    await runAll(store);
    const priorBuildings = store.data.buildings;

    jumpTo(FLOW, registry, store, "draw");
    expect(store.data.coordinates).toBeUndefined();
    expect(store.data.buildings).toBeUndefined();

    store.undo();

    expect(store.data.coordinates).toEqual([[[8.6, 49.4]]]);
    expect(store.data.buildings).toEqual(priorBuildings);
  });
});

describe("T20c — walking the tail re-runs only what the jump invalidated", () => {
  it("runs the invalidated nodes in flow order and elides the rest", async () => {
    const store = createStore(seed());
    await runAll(store);
    jumpTo(FLOW, registry, store, "draw");

    const engine = createEngine(store);
    const ran = await walkTail(FLOW, registry, store, engine.runModule);

    // `start` was never touched, and `save` came back valid once `buildings` was re-derived.
    expect(ran).toEqual(["draw", "grid"]);
    expect(position(FLOW, registry, store).complete).toBe(true);
  });

  it("elides a node whose inputs a re-run restores unchanged", async () => {
    const store = createStore(seed());
    await runAll(store);
    jumpTo(FLOW, registry, store, "grid");

    const engine = createEngine(store);
    const ran = await walkTail(FLOW, registry, store, engine.runModule);

    // Only buildings was discarded, and grid re-derives it identically: save's input is whole
    // again and its own output was never thrown away, so it is not run.
    expect(ran).toEqual(["grid"]);
    expect(nodeStates(FLOW, registry, store)).toEqual({
      start: "done",
      draw: "done",
      grid: "done",
      save: "done",
    });
  });

  it("stops before a node the caller wants the user to see", async () => {
    const store = createStore(seed());
    await runAll(store);
    jumpTo(FLOW, registry, store, "draw");

    const engine = createEngine(store);
    const ran = await walkTail(FLOW, registry, store, engine.runModule, {
      stopWhen: (node) => node.moduleId === "grid",
    });

    expect(ran).toEqual(["draw"]);
    expect(nodeStates(FLOW, registry, store).grid).toBe("stale");
  });
});
