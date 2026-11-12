/**
 * Position — derived flow state (case T20, slice B).
 *
 * Spec: `.local/ModularThesis/spec/core.md` §G. A flow is immutable and the session's position
 * in it is **derived** from `(projection, log, cursor)`, so undo/redo reposition the flow with
 * no bookkeeping, and a jump only has to prune its target's outputs to make the position rest
 * there.
 *
 * Written failing first.
 */
import { describe, it, expect } from "vitest";
import { activeNode, nodeStates, position, positionReport } from "./position";
import type { ModuleRegistry } from "./flow";
import { createEngine } from "./engine";
import { createStore } from "./store";
import { defineModule } from "./module";
import { building, fc, seed } from "./fixtures";
import type { PortKey } from "./ports";

// ── a four-node flow ────────────────────────────────────────────────────────

const REGION: PortKey = "region";
const COORDINATES: PortKey = "coordinates";
const BUILDINGS: PortKey = "buildings";
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
  params: [{ port: COORDINATES, required: true }, { port: BUILDINGS }],
  affect: { coordinates: [BUILDINGS] },
  layout: [],
  run: (ctx) => {
    ctx.read(BUILDINGS);
    ctx.commit({ buildings: fc([building("b1")]) });
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

const GRID_BUILDINGS = fc([building("b1")]);
/** A module used by one case, whose id is quoted repeatedly. */
const DECLARES_MORE = "declares-more";
// ── helpers ─────────────────────────────────────────────────────────────────

async function run(store: ReturnType<typeof createStore>, moduleId: string): Promise<void> {
  await createEngine(store).runModule(registry[moduleId], { id: moduleId });
}

async function runAll(store: ReturnType<typeof createStore>): Promise<void> {
  for (const moduleId of ["start", "draw", "grid", "save"]) await run(store, moduleId);
}

// ── T20 (position) ──────────────────────────────────────────────────────────

describe("T20b — the position is derived from the log", () => {
  it("sits at the first node that has not run", async () => {
    const store = createStore(seed());
    await run(store, "start");
    await run(store, "draw");
    await run(store, "grid");

    const current = position(FLOW, registry, store);

    expect(current).toMatchObject({ index: 3, nodeId: "save", complete: false });
    expect(activeNode(FLOW, registry, store)?.id).toBe("save");
    expect(nodeStates(FLOW, registry, store)).toEqual({
      start: "done",
      draw: "done",
      grid: "done",
      save: "pending",
    });
  });

  it("starts at the first node when nothing has run", () => {
    const store = createStore(seed());

    expect(position(FLOW, registry, store)).toMatchObject({ index: 0, nodeId: "start" });
    expect(Object.values(nodeStates(FLOW, registry, store))).toEqual([
      "pending",
      "pending",
      "pending",
      "pending",
    ]);
  });

  it("reports a complete flow past the last node", async () => {
    const store = createStore(seed());
    await runAll(store);

    expect(position(FLOW, registry, store)).toMatchObject({ index: 4, complete: true });
    expect(activeNode(FLOW, registry, store)).toBeUndefined();
  });

  it("rests at the first node whose work was pruned — that is what makes a jump do anything", async () => {
    const store = createStore(seed());
    await runAll(store);

    // A jump back to `grid`: its output is pruned, so it can no longer read as done.
    store.applyTransaction([], [{ op: "remove", path: "/buildings", prev: GRID_BUILDINGS }], {
      node: { id: "grid" },
      kind: "jump",
      jump: { from: "save", to: "grid" },
    });

    const current = position(FLOW, registry, store);
    const report = positionReport(FLOW, registry, store);

    expect(current).toMatchObject({ index: 2, nodeId: "grid", complete: false });
    expect(report[2]).toMatchObject({ state: "stale", pruned: [BUILDINGS] });
    // save ran, but its input is gone — it cannot be called done either
    expect(report[3]).toMatchObject({ state: "stale", blocked: [BUILDINGS] });
    expect(report.slice(0, 2).map((entry) => entry.state)).toEqual(["done", "done"]);
  });

  it("moves back with undo, with no bookkeeping of its own", async () => {
    const store = createStore(seed());
    await runAll(store);
    expect(position(FLOW, registry, store).complete).toBe(true);

    store.undo();

    expect(position(FLOW, registry, store)).toMatchObject({ index: 3, nodeId: "save" });
    expect(nodeStates(FLOW, registry, store).save).toBe("pending");
  });

  it("believes the log about what a node wrote, not its declaration", async () => {
    // Declares `lines` but never writes it: were done-ness derived from declarations, this
    // node would read as stale forever.
    const LINES: PortKey = "lines";
    const declaresMore = defineModule({
      id: DECLARES_MORE,
      params: [{ port: COORDINATES, required: true }, { port: BUILDINGS }, { port: LINES }],
      affect: {},
      layout: [],
      run: (ctx) => {
        ctx.read(BUILDINGS);
        ctx.commit({ buildings: fc([building("b1")]) });
      },
      validate: () => [],
    });

    const store = createStore(seed());
    await run(store, "start");
    await run(store, "draw");
    await createEngine(store).runModule(declaresMore, { id: DECLARES_MORE });

    const flow = [{ id: DECLARES_MORE, moduleId: DECLARES_MORE }];
    const local: ModuleRegistry = { [DECLARES_MORE]: declaresMore };

    expect(store.data.lines).toBeUndefined();
    expect(positionReport(flow, local, store)[0]).toMatchObject({ state: "done", pruned: [] });
  });
});
