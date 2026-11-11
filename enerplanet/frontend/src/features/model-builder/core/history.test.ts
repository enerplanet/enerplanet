/**
 * History — undo/redo over the append-only log (cases T4–T6).
 *
 * Spec: `.local/ModularThesis/spec/core.md` §A. These lock `Plan.md` §4/§6: undo restores
 * a sealed transaction's pre-values *exactly*, a new edit truncates the redo tail, and redo
 * re-derives the cascade instead of replaying the stored prunes.
 *
 * Written failing first.
 */
import { describe, it, expect } from "vitest";
import { createStore } from "./store";
import { createEngine } from "./engine";
import { defineModule } from "./module";
import type { DiffOp } from "./diff";
import { building, fc, seed } from "./fixtures";

/** The primary diff used throughout: a drawn area replacing the empty coordinates. */
const COORDINATES_EDIT: DiffOp = {
  op: "replace",
  path: "/coordinates",
  prev: [],
  next: [[[8.6, 49.4]]],
};

function rename(from: string, to: string): DiffOp {
  return { op: "replace", path: "/modelName", prev: from, next: to };
}

/** The name `seed()` starts with; T5 renames it repeatedly. */
const INITIAL_NAME = "Contract fixture";

// ── T4 ──────────────────────────────────────────────────────────────────────

describe("T4 — undo restores pruned downstream edits exactly", () => {
  it("brings back a user-edited downstream port and the primary pre-value", () => {
    const userEdited = fc([building("user-edit")]);
    const priorTransformers = fc([building("t1")]);
    const store = createStore(seed({ buildings: userEdited, transformers: priorTransformers }));

    const transaction = store.applyTransaction([COORDINATES_EDIT], [
      { op: "remove", path: "/buildings", prev: userEdited },
      { op: "remove", path: "/transformers", prev: priorTransformers },
    ]);

    expect(transaction.revision).toBe(1);
    expect(store.data.coordinates).toEqual([[[8.6, 49.4]]]);
    expect(store.data.buildings).toBeUndefined();

    expect(store.undo()).toBeDefined();

    // exactly what was there before — including the user's own edit
    expect(store.data.buildings).toEqual(userEdited);
    expect(store.data.transformers).toEqual(priorTransformers);
    expect(store.data.coordinates).toEqual([]);
    expect(store.cursor).toBe(0);
    expect(store.log).toHaveLength(1); // undo never rewrites the log
    expect(store.log[0]).toBe(transaction);
  });
});

// ── T5 ──────────────────────────────────────────────────────────────────────

describe("T5 — a new edit after undo truncates the redo tail", () => {
  it("drops the abandoned tail, leaves its entries untouched, keeps undo working", () => {
    const store = createStore(seed());
    const first = store.applyTransaction([rename(INITIAL_NAME, "one")]);
    const second = store.applyTransaction([rename("one", "two")]);

    expect(store.undo()).toBeDefined();
    expect(store.undo()).toBeDefined();
    expect(store.cursor).toBe(0);
    expect(store.log).toHaveLength(2);
    expect(store.canRedo).toBe(true);

    const third = store.applyTransaction([rename(INITIAL_NAME, "three")]);

    expect(store.log).toHaveLength(1);
    expect(store.log[0]).toBe(third);
    expect(store.cursor).toBe(1);
    expect(store.canRedo).toBe(false);
    expect(store.data.modelName).toBe("three");

    // the abandoned entries were dropped, not mutated
    expect(first.primary[0]).toMatchObject({ prev: INITIAL_NAME, next: "one" });
    expect(second.primary[0]).toMatchObject({ prev: "one", next: "two" });

    // and undo still walks what survived
    expect(store.undo()).toBeDefined();
    expect(store.data.modelName).toBe(INITIAL_NAME);
    expect(store.cursor).toBe(0);
    expect(store.undo()).toBeUndefined();
  });
});

// ── T6 ──────────────────────────────────────────────────────────────────────

describe("T6 — redo recomputes the cascade instead of replaying it", () => {
  it("re-derives the cascade from the current projection", () => {
    const staleBuildings = seed().buildings;
    const seen: Array<{ primary: readonly DiffOp[]; data: unknown }> = [];

    const store = createStore(seed(), {
      // The invalidation seam (`Plan.md` §5). A state-dependent invalidator may answer
      // differently than it did at seal time — redone work must never resurrect stale
      // prunes, so redo asks instead of replaying what the transaction stored.
      deriveCascade: (primary, data) => {
        seen.push({ primary, data: data.buildings });
        return []; // "nothing downstream is stale any more"
      },
    });

    store.applyTransaction([COORDINATES_EDIT], [
      { op: "remove", path: "/buildings", prev: staleBuildings },
    ]);
    expect(store.data.buildings).toBeUndefined();

    expect(store.undo()).toBeDefined();
    expect(store.data.buildings).toEqual(staleBuildings);

    expect(store.redo()).toBeDefined();

    expect(seen).toHaveLength(1); // redo consulted the invalidator…
    expect(seen[0].primary).toEqual([COORDINATES_EDIT]);
    expect(store.data.coordinates).toEqual([[[8.6, 49.4]]]); // …re-applied the primary…
    expect(store.data.buildings).toEqual(staleBuildings); // …and did NOT replay the stored prune
    expect(store.cursor).toBe(1);
    expect(store.log).toHaveLength(1);
    expect(store.redo()).toBeUndefined();
  });
});

// ── T14 ─────────────────────────────────────────────────────────────────────

describe("T14 — undo skips auto work and lands on the interactive boundary", () => {
  /** node1 → node2 → autonode3 → node4, each writing a distinct port. */
  async function chain(): Promise<{ store: ReturnType<typeof createStore>; engine: ReturnType<typeof createEngine> }> {
    const store = createStore(seed());
    const engine = createEngine(store);

    const node1 = defineModule({
      id: "node1",
      params: [{ port: "coordinates" }],
      affect: {},
      layout: [],
      run: (ctx) => {
        ctx.read("coordinates");
        ctx.commit({ coordinates: [[[8.6, 49.4]]] });
      },
      validate: () => [],
    });
    const node2 = defineModule({
      id: "node2",
      params: [{ port: "buildings" }],
      affect: {},
      layout: [],
      run: (ctx) => {
        ctx.read("buildings");
        ctx.commit({ buildings: fc([building("b1")]) });
      },
      validate: () => [],
    });
    const autonode3 = defineModule({
      id: "autonode3",
      params: [{ port: "buildings" }, { port: "grids" }],
      affect: {},
      layout: [],
      run: (ctx) => {
        ctx.read("buildings");
        ctx.commit({ grids: { buildings: 1 } });
      },
      validate: () => [],
    });
    const node4 = defineModule({
      id: "node4",
      params: [{ port: "transformers" }],
      affect: {},
      layout: [],
      run: (ctx) => ctx.commit({ transformers: fc([building("t1")]) }),
      validate: () => [],
    });

    await engine.runModule(node1, { id: "node1" });
    await engine.runModule(node2, { id: "node2" });
    await engine.runModule(autonode3, { id: "autonode3", auto: true });
    await engine.runModule(node4, { id: "node4" });
    return { store, engine };
  }

  it("unwinds the trailing interactive step *and* the auto node before it", async () => {
    const { store } = await chain();
    expect(store.cursor).toBe(4);

    const report = store.undo();

    expect(report?.transactions).toBe(2);
    expect(report?.nodeIds).toEqual(["node4", "autonode3"]);
    expect(store.cursor).toBe(2); // end of node2's group — not the auto node
    expect(store.data.transformers).toBeUndefined();
    expect(store.data.grids).toBeUndefined(); // the auto node's output is gone
    expect(store.data.buildings).toEqual(fc([building("b1")]));
  });

  it("redo is the inverse: it walks back over the auto node to the interactive tip", async () => {
    const { store } = await chain();
    store.undo();

    const report = store.redo();

    expect(report?.transactions).toBe(2);
    expect(report?.nodeIds).toEqual(["autonode3", "node4"]);
    expect(store.cursor).toBe(4);
    expect(store.data.grids).toEqual({ buildings: 1 });
    expect(store.data.transformers).toEqual(fc([building("t1")]));
  });
});

// ── T15 ─────────────────────────────────────────────────────────────────────

describe("T15 — undo alone never produces writes", () => {
  it("does not re-run the auto node it unwound", async () => {
    const store = createStore(seed());
    const engine = createEngine(store);
    let autoRuns = 0;

    const loader = defineModule({
      id: "loader",
      params: [{ port: "region" }],
      affect: {},
      layout: [],
      run: (ctx) => ctx.commit({ region: { country: "DE", state: "BW" } }),
      validate: () => [],
    });
    const auto = defineModule({
      id: "autonode",
      params: [{ port: "buildings" }, { port: "grids" }],
      affect: {},
      layout: [],
      run: (ctx) => {
        autoRuns += 1;
        ctx.read("buildings");
        ctx.commit({ grids: { run: autoRuns } });
      },
      validate: () => [],
    });
    const editor = defineModule({
      id: "editor",
      params: [{ port: "transformers" }],
      affect: {},
      layout: [],
      run: (ctx) => ctx.commit({ transformers: fc() }),
      validate: () => [],
    });

    await engine.runModule(loader, { id: "loader" });
    await engine.runModule(auto, { id: "autonode", auto: true });
    await engine.runModule(editor, { id: "editor" });
    expect(autoRuns).toBe(1);
    const logLength = store.log.length;

    const report = store.undo();

    expect(report?.nodeIds).toEqual(["editor", "autonode"]);
    expect(store.cursor).toBe(1);
    expect(store.log).toHaveLength(logLength); // undo wrote nothing…
    expect(autoRuns).toBe(1); // …and the auto module was never re-run
    expect(store.data.grids).toBeUndefined();
  });
});
