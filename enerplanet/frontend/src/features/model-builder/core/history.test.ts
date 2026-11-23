/**
 * History — undo/redo as commits over the append-only log.
 *
 * v2 model (`spec/history-v2.md` §1, §4.1): the log is **append-only with no truncation**, and
 * undo/redo are themselves commits in the **`git revert` shape** — undo appends a rollback whose
 * `primary` is the inverse of the target's change + cascade, resolving the model to the state
 * before it. The target stays in the log as a superseded occurrence, so nothing rewrites an entry.
 *
 * These lock: undo restores a commit's pre-values *exactly* (including cascade pruned values), a
 * new edit after an undo **appends** rather than truncating, redo re-applies, and undo skips auto
 * work.
 *
 * Written failing first against the new design.
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


describe("undo alone never produces writes, and skips auto work", () => {
  it("does not re-run the auto node it skipped over", async () => {
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
    expect(autoRuns).toBe(1);
    const logLength = store.log.length;

    const rollback = store.undo();

    // The auto commit at the tip is skipped: undo resolves the interactive `loader` below it.
    expect(rollback?.rollback).toEqual({ of: 1 });
    expect(store.log).toHaveLength(logLength + 1); // undo wrote only its own rollback commit
    expect(autoRuns).toBe(1); // …and the auto module was never re-run
    expect(store.data.region).toBeUndefined();
    expect(store.data.grids).toEqual({ run: 1 }); // the auto work is untouched, not unwound
  });
});
