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
    await createEngine(store).runModule(declaresMore, { id: DECLARES_MORE });

    const flow = [{ id: DECLARES_MORE, moduleId: DECLARES_MORE }];
    const local: ModuleRegistry = { [DECLARES_MORE]: declaresMore };

    expect(store.data.lines).toBeUndefined();
    expect(positionReport(flow, local, store)[0]).toMatchObject({ state: "done", pruned: [] });
  });
});

// ── T22 (a node finishes only when its own gate is satisfied) ───────────────

describe("T22 — a node is done only when the module's own gate is satisfied", () => {
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
    // promotes to `draft` would be one the flow only *walked past*. The node ran and sealed a transaction;
    // it is still not done, so the position rests there.
    const store = createStore(seed({ coordinates: [[[8.6, 49.4]]] }));
    await createEngine(store).runModule(picky([]), { id: PICKY });

    const flow = [{ id: PICKY, moduleId: PICKY }];
    const local: ModuleRegistry = { [PICKY]: picky([]) };

    expect(store.log).toHaveLength(1); // it did write
    expect(nodeStates(flow, local, store)[PICKY]).toBe("stale");
    expect(position(flow, local, store)).toMatchObject({ index: 0, complete: false });
  });

  it("reads the same node as done once the gate is satisfied", async () => {
    const store = createStore(seed({ coordinates: [[[8.6, 49.4]]] }));
    await createEngine(store).runModule(picky([building("b1")]), { id: PICKY });

    const flow = [{ id: PICKY, moduleId: PICKY }];
    const local: ModuleRegistry = { [PICKY]: picky([building("b1")]) };

    expect(nodeStates(flow, local, store)[PICKY]).toBe("done");
    expect(position(flow, local, store).complete).toBe(true);
  });

  it("treats a module with no gate as always satisfied", async () => {
    // `validate` is optional: a module that makes no completeness claim is done when it ran. Silence is
    // not an oversight here — it is the module saying it has nothing to check.
    const store = createStore(seed());
    await run(store, "start");

    expect(positionReport(FLOW, registry, store)[0]).toMatchObject({ state: "done" });
  });
});

// ── T20a (a bare re-run clears the re-arm a jump left) ──────────────────────

describe("T20a — a jump's re-arm clears on the next run, without an edit", () => {
  it("lets a node jumped back to read done again after pressing forward without retyping", async () => {
    // The user's exact complaint: a jump back to a finished node re-arms it (T20a), and a form holds only what
    // was actually retyped — so coming back to look and pressing the forward action holds nothing. If a no-op
    // run sealed no transaction the re-arm would never clear, the node would read `stale` forever, and the only
    // way out would be to invent an edit. Going back to look is not an edit, so the run must leave a trace.
    const REVISIT = "revisit";
    let held: string | undefined;
    const revisit = defineModule({
      id: REVISIT,
      params: [{ port: "modelName" }],
      affect: {},
      layout: [],
      run: (ctx) => {
        const proposed = held;
        held = undefined;
        if (proposed === undefined) return; // the form collected nothing
        const current = ctx.read("modelName");
        if (current === proposed) return; // nothing changed — read before you write
        ctx.commit({ modelName: proposed });
      },
      validate: () => [],
    });

    const store = createStore(seed());
    const flow = [{ id: REVISIT, moduleId: REVISIT }];
    const local: ModuleRegistry = { [REVISIT]: revisit };

    // First run: a real write, so the node is done.
    held = "Karlsruhe";
    await createEngine(store).runModule(revisit, { id: REVISIT });
    expect(nodeStates(flow, local, store)[REVISIT]).toBe("done");

    // A jump back to it that discards nothing — the re-arm is the only effect.
    store.applyTransaction([], [], {
      node: { id: REVISIT },
      kind: "jump",
      jump: { from: "draw", to: REVISIT },
    });
    expect(nodeStates(flow, local, store)[REVISIT]).toBe("stale");

    // Press forward again, holding nothing — the bare run seals one zero-diff transaction, and that newer
    // transaction is what clears the re-arm.
    await createEngine(store).runModule(revisit, { id: REVISIT });

    expect(store.data.modelName).toBe("Karlsruhe");
    expect(nodeStates(flow, local, store)[REVISIT]).toBe("done");
  });
});
