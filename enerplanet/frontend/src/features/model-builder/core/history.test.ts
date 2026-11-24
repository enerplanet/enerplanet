/**
 * History — undo/redo as commits over the append-only log: undo restores a commit's pre-values
 * exactly, a new edit appends rather than truncating, and undo lands on auto work too.
 */
import { describe, it, expect } from "vitest";
import { createStore } from "./store";
import { createEngine } from "./engine";
import { defineModule } from "./module";
import type { DiffOp } from "./diff";
import { building, fc, seed } from "./fixtures";
import { nodeStates } from "./position";
import type { ModuleRegistry } from "./flow";

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

/** The name `seed()` starts with. */
const INITIAL_NAME = "Contract fixture";

const BUILDINGS_PATH = "/buildings";
const TRANSFORMERS_PATH = "/transformers";


describe("undo restores pruned downstream edits exactly, by appending a rollback", () => {
  it("brings back a user-edited downstream port and the primary pre-value; the target stays", () => {
    const userEdited = fc([building("user-edit")]);
    const priorTransformers = fc([building("t1")]);
    const store = createStore(seed({ buildings: userEdited, transformers: priorTransformers }));

    const transaction = store.applyTransaction([COORDINATES_EDIT], [
      { op: "remove", path: BUILDINGS_PATH, prev: userEdited },
      { op: "remove", path: TRANSFORMERS_PATH, prev: priorTransformers },
    ]);

    expect(transaction.revision).toBe(1);
    expect(store.data.coordinates).toEqual([[[8.6, 49.4]]]);
    expect(store.data.buildings).toBeUndefined();

    const rollback = store.undo();

    expect(rollback).toBeDefined();
    expect(rollback?.revision).toBe(2);
    expect(rollback?.rollback).toEqual({ of: 1 });
    expect(rollback?.node).toBeUndefined(); // a rollback resolves the model, it is no placement's work

    // exactly what was there before — including the user's own edit
    expect(store.data.buildings).toEqual(userEdited);
    expect(store.data.transformers).toEqual(priorTransformers);
    expect(store.data.coordinates).toEqual([]);

    // append-only: the log gained the rollback, it did not lose or rewrite the target
    expect(store.log).toHaveLength(2);
    expect(store.log[0]).toBe(transaction);
    expect(store.log[1]).toBe(rollback);
  });
});


describe("a new edit after undo appends — nothing is truncated", () => {
  it("keeps both superseded commits and appends the new one", () => {
    const store = createStore(seed());
    const first = store.applyTransaction([rename(INITIAL_NAME, "one")]);
    const second = store.applyTransaction([rename("one", "two")]);

    expect(store.undo()).toBeDefined();
    expect(store.data.modelName).toBe("one"); // the rollback resolves rev2 (one → two)
    expect(store.log).toHaveLength(3); // two commits + the rollback
    expect(store.canRedo).toBe(true);

    const third = store.applyTransaction([rename(INITIAL_NAME, "three")]);

    // append-only: the rollback and both superseded commits are still present
    expect(store.log).toHaveLength(4);
    expect(store.log[0]).toBe(first);
    expect(store.log[1]).toBe(second);
    expect(store.log[3]).toBe(third);
    expect(store.data.modelName).toBe("three");

    // the abandoned entries were never mutated
    expect(first.primary[0]).toMatchObject({ prev: INITIAL_NAME, next: "one" });
    expect(second.primary[0]).toMatchObject({ prev: "one", next: "two" });
  });
});


describe("redo re-applies by appending the inverse of the rollback", () => {
  it("resolves the model forward again", () => {
    const store = createStore(seed());
    store.applyTransaction([rename(INITIAL_NAME, "one")]);

    expect(store.undo()).toBeDefined();
    expect(store.data.modelName).toBe(INITIAL_NAME);

    const redone = store.redo();

    expect(redone).toBeDefined();
    expect(redone?.rollback).toEqual({ of: 2 });
    expect(store.data.modelName).toBe("one");
    expect(store.log).toHaveLength(3);
  });

  it("alternates undo and redo without oscillating", () => {
    const store = createStore(seed());
    store.applyTransaction([rename(INITIAL_NAME, "one")]);

    expect(store.canUndo).toBe(true);
    expect(store.canRedo).toBe(false);

    store.undo();
    expect(store.data.modelName).toBe(INITIAL_NAME);
    expect(store.canUndo).toBe(false);
    expect(store.canRedo).toBe(true);

    store.redo();
    expect(store.data.modelName).toBe("one");
    expect(store.canUndo).toBe(true);
    expect(store.canRedo).toBe(false);

    store.undo();
    expect(store.data.modelName).toBe(INITIAL_NAME);
    store.redo();
    expect(store.data.modelName).toBe("one");
  });
});


describe("repeated undo walks back through history", () => {
  it("resolves one commit at a time, then runs out", () => {
    const store = createStore(seed());
    store.applyTransaction([rename(INITIAL_NAME, "a")]);
    store.applyTransaction([rename("a", "b")]);
    store.applyTransaction([rename("b", "c")]);

    expect(store.undo()).toBeDefined();
    expect(store.data.modelName).toBe("b");
    expect(store.undo()).toBeDefined();
    expect(store.data.modelName).toBe("a");
    expect(store.undo()).toBeDefined();
    expect(store.data.modelName).toBe(INITIAL_NAME);
    expect(store.undo()).toBeUndefined();

    expect(store.log).toHaveLength(6); // three commits + three rollbacks
  });
});


describe("undo lands on auto work too — auto is a normal target", () => {
  /** `loader` (interactive) writes `region`; `autonode` (auto) reads `buildings`, writes `grids`. */
  async function chain(): Promise<{
    store: ReturnType<typeof createStore>;
    registry: ModuleRegistry;
    runs: () => number;
  }> {
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

    await engine.runModule(loader, { id: "loader", moduleId: "loader" });
    await engine.runModule(auto, { id: "autonode", moduleId: "autonode", auto: true });
    return { store, registry: { loader, autonode: auto }, runs: () => autoRuns };
  }

  it("an undo reverses the auto step first, the next the interactive step below it", async () => {
    const { store, runs } = await chain();
    expect(runs()).toBe(1);
    // The commit is marked automatic, so the run can be read back from history later.
    expect(store.log[1].auto).toBe(true);

    const first = store.undo();

    expect(first?.rollback).toEqual({ of: 2 }); // the auto commit is the newest forward one
    expect(store.data.grids).toBeUndefined(); // so its work is reversed…
    expect(store.data.region).toEqual({ country: "DE", state: "BW" }); // …and the step below stands

    const second = store.undo();
    expect(second?.rollback).toEqual({ of: 1 });
    expect(store.data.region).toBeUndefined();

    expect(runs()).toBe(1); // an undo never re-runs anything
  });

  it("a redo repopulates the auto step's data, so it reads done again", async () => {
    const { store, registry } = await chain();
    const flow = [
      { id: "loader", moduleId: "loader" },
      { id: "autonode", moduleId: "autonode" },
    ];

    store.undo();

    expect(store.data.grids).toBeUndefined();
    expect(nodeStates(flow, registry, store).autonode).toBe("stale"); // its work was reversed

    store.redo();

    // The data is back, so the placement reads its own commit as done — nothing has to re-run.
    expect(store.data.grids).toEqual({ run: 1 });
    expect(nodeStates(flow, registry, store).autonode).toBe("done");
    expect(store.undo()).toBeDefined(); // and a redo is itself revertible
  });
});


describe("an edit after an undo takes redo away", () => {
  it("a new commit is the tip, so the undone run can no longer be re-applied", () => {
    const store = createStore(seed());
    store.applyTransaction([rename(INITIAL_NAME, "one")]);

    store.undo();
    expect(store.canRedo).toBe(true);

    store.applyTransaction([rename(INITIAL_NAME, "two")], undefined, {
      // An edit is a placement's work, so it carries a node — that is what moves the tip.
      node: { id: "edit-name", moduleId: "editor" },
    });

    expect(store.canRedo).toBe(false);
    expect(store.redo()).toBeUndefined();
    expect(store.data.modelName).toBe("two");
  });
});
