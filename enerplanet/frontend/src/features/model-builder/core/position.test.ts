/**
 * Position — a placement's state read from its own single commit (`done` / `stale` / `pending`),
 * with `index` the frontier: the first placement that is not done.
 */
import { describe, it, expect } from "vitest";
import { activeNode, nodeStates, position, positionReport } from "./position";
import { placementId, transcript, type ModuleRegistry } from "./flow";
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
  await createEngine(store).runModule(registry[moduleId], { id: moduleId, moduleId });
}

async function runAll(store: ReturnType<typeof createStore>): Promise<void> {
  for (const moduleId of ["start", "draw", "grid", "save"]) await run(store, moduleId);
}


describe("the position is the frontier: the first placement that is not done", () => {
  it("sits at the first placement that has not run", async () => {
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

  it("starts at the first placement when nothing has run", () => {
    const store = createStore(seed());

    expect(position(FLOW, registry, store)).toMatchObject({ index: 0, nodeId: "start" });
    expect(Object.values(nodeStates(FLOW, registry, store))).toEqual([
      "pending",
      "pending",
      "pending",
      "pending",
    ]);
  });

  it("reports a complete transcript past the last placement", async () => {
    const store = createStore(seed());
    await runAll(store);

    expect(position(FLOW, registry, store)).toMatchObject({ index: 4, complete: true });
    expect(activeNode(FLOW, registry, store)).toBeUndefined();
  });

  it("rests on the first placement whose work was pruned — the frontier follows the data", async () => {
    const store = createStore(seed());
    await runAll(store);

    // A prune of grid's output (as its own re-run's cascade would do): grid's own commit no
    // longer has a value in the store, so it reads stale and the frontier rests there. The prune
    // carries no node — it is not grid's work, so it adds no commit to grid.
    store.applyTransaction([], [{ op: "remove", path: "/buildings", prev: GRID_BUILDINGS }]);

    const current = position(FLOW, registry, store);
    const report = positionReport(FLOW, registry, store);

    expect(current).toMatchObject({ index: 2, nodeId: "grid", complete: false });
    expect(report[2]).toMatchObject({ state: "stale", pruned: [BUILDINGS] });
    // save ran, but its input is gone — it cannot be called done either
    expect(report[3]).toMatchObject({ state: "stale", blocked: [BUILDINGS] });
    expect(report.slice(0, 2).map((entry) => entry.state)).toEqual(["done", "done"]);
  });

  it("resolves back with undo, following the data", async () => {
    const store = createStore(seed());
    await runAll(store);
    expect(position(FLOW, registry, store).complete).toBe(true);

    store.undo(); // a rollback of save's commit — save's output leaves the store

    expect(position(FLOW, registry, store)).toMatchObject({ index: 3, nodeId: "save" });
    expect(nodeStates(FLOW, registry, store).save).toBe("stale");
  });

  it("believes the log about what a placement wrote, not its declaration", async () => {
    // Declares `lines` but never writes it: were done-ness derived from declarations, this
    // node would read as stale forever. Declarations are not promises — a module that writes less than
    // it declares is fine, as long as its own `validate()` is satisfied with what it did produce.
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
    await createEngine(store).runModule(declaresMore, { id: DECLARES_MORE, moduleId: DECLARES_MORE });

    const flow = [{ id: DECLARES_MORE, moduleId: DECLARES_MORE }];
    const local: ModuleRegistry = { [DECLARES_MORE]: declaresMore };

    expect(store.data.lines).toBeUndefined();
    expect(positionReport(flow, local, store)[0]).toMatchObject({ state: "done", pruned: [] });
  });
});


describe("a placement is done only when the module's own gate is satisfied", () => {
  const PICKY = "picky-grid";

  /**
   * A module whose `validate()` is the real gate: it wrote *something*, but not enough to stand behind.
   * This is the shape `grid-generation` has — an area can legitimately yield no buildings, and the module
   * is the only thing that knows whether what it produced is finished.
   */
  function picky(buildings: readonly unknown[]) {
    return defineModule({
      id: PICKY,
      params: [{ port: COORDINATES, required: true }, { port: BUILDINGS }],
      affect: {},
      layout: [],
      run: (ctx) => {
        ctx.read(BUILDINGS);
        ctx.commit({ buildings: fc(buildings as never[]) });
      },
      validate: (ctx) =>
        (ctx.store.buildings?.features.length ?? 0) > 0
          ? []
          : [{ port: BUILDINGS, message: "The area yielded no buildings." }],
    });
  }

  it("reads a finished run as stale while the gate reports issues", async () => {
    // Without this rule, "every node done" means "every node was visited" — and the model the save node
    // promotes to `draft` would be one the flow only *walked past*.
    const store = createStore(seed({ coordinates: [[[8.6, 49.4]]] }));
    await createEngine(store).runModule(picky([]), { id: PICKY, moduleId: PICKY });

    const flow = [{ id: PICKY, moduleId: PICKY }];
    const local: ModuleRegistry = { [PICKY]: picky([]) };

    expect(store.log).toHaveLength(1); // it did write
    expect(nodeStates(flow, local, store)[PICKY]).toBe("stale");
    expect(position(flow, local, store)).toMatchObject({ index: 0, complete: false });
  });

  it("reads the same placement as done once the gate is satisfied", async () => {
    const store = createStore(seed({ coordinates: [[[8.6, 49.4]]] }));
    await createEngine(store).runModule(picky([building("b1")]), { id: PICKY, moduleId: PICKY });

    const flow = [{ id: PICKY, moduleId: PICKY }];
    const local: ModuleRegistry = { [PICKY]: picky([building("b1")]) };

    expect(nodeStates(flow, local, store)[PICKY]).toBe("done");
    expect(position(flow, local, store).complete).toBe(true);
  });

  it("treats a module with no gate as always satisfied", async () => {
    const store = createStore(seed());
    await run(store, "start");

    expect(positionReport(FLOW, registry, store)[0]).toMatchObject({ state: "done" });
  });

  it("reads a run that had nothing to write as done, not stale", async () => {
    const IDLE = "idle";
    const idle = defineModule({
      id: IDLE,
      params: [{ port: BUILDINGS, required: true }],
      affect: {},
      layout: [],
      run: () => undefined,
      validate: () => [],
    });

    const store = createStore(seed({ buildings: fc([building("b1")]) }));
    await createEngine(store).runModule(idle, { id: IDLE, moduleId: IDLE });

    const flow = [{ id: IDLE, moduleId: IDLE }];
    const local: ModuleRegistry = { [IDLE]: idle };

    // The run still sealed a commit — a run always leaves a trace — and the placement is finished by it.
    expect(store.log).toHaveLength(1);
    expect(nodeStates(flow, local, store)[IDLE]).toBe("done");
    expect(position(flow, local, store).complete).toBe(true);
  });
});


describe("the transcript grows by appends, and every placement keys its own state", () => {
  it("appends a successor placement and reads both occurrences from their own commits", async () => {
    const store = createStore(seed());
    await runAll(store);

    // A re-run of `grid` appends a successor placement rather than rewriting `grid`.
    const successor = placementId(transcript(FLOW, store.log).length, "grid");
    await createEngine(store).runModule(grid, { id: successor, moduleId: "grid" });

    const full = transcript(FLOW, store.log);
    expect(full.map((node) => node.id)).toEqual(["start", "draw", "grid", "save", "4-grid"]);

    const states = nodeStates(full, registry, store);
    expect(states["grid"]).toBe("done"); // the earlier occurrence is untouched
    expect(states["4-grid"]).toBe("done"); // the successor, from its own commit
    expect(position(full, registry, store).complete).toBe(true);
  });
});
