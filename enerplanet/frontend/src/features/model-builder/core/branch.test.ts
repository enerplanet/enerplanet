/**
 * Branching — "New Model" at the prompt (case T17).
 *
 * Spec: `.local/ModularThesis/spec/core.md` §F. A branch is **full duplex**: it carries a copy of
 * the projection at the cursor, a copy of the log *prefix*, the pending change as its own first
 * transaction, and an empty discard stack — while the source session is left bit-identical, log,
 * cursor and redo tail intact. Nothing is shared, so a branch replays its own diffs and needs no
 * parent to load (`Plan.md` §9).
 *
 * Written failing first.
 */
import { describe, it, expect } from "vitest";
import { branch } from "./branch";
import { fromArtefact, toArtefact } from "./artefact";
import { fingerprint } from "./fingerprint";
import { createStore } from "./store";
import { seed } from "./fixtures";

const WORKFLOW = { id: "wf-core", version: 3 };
const MODEL_NAME_PATH = "/modelName";
const PENDING = { op: "replace", path: MODEL_NAME_PATH, prev: "V1", next: "V3" } as const;

/** A session with three transactions, sitting two in — so it has a redo tail to keep. */
function session(): ReturnType<typeof createStore> {
  const store = createStore(seed());
  store.applyTransaction(
    [{ op: "replace", path: MODEL_NAME_PATH, prev: "Contract fixture", next: "V1" }],
    [],
    { node: { id: "model-start" } },
  );
  store.applyTransaction([{ op: "replace", path: "/resolution", prev: 60, next: 30 }], [], {
    node: { id: "settings" },
  });
  store.applyTransaction([{ op: "replace", path: MODEL_NAME_PATH, prev: "V1", next: "V2" }], [], {
    node: { id: "rename" },
  });
  store.undo(); // cursor 2 of 3: the tail stays behind
  return store;
}

const REQUEST = {
  parent: { modelId: 12, groupId: 7 },
  pending: { primary: [PENDING], node: { id: "user-edit" } },
} as const;

// ── T17 ─────────────────────────────────────────────────────────────────────

describe("T17 — branch = state + prefix + the pending change", () => {
  it("starts where the source sits, plus the pending change, with no discard stack", () => {
    const store = session();

    const { store: branched, link } = branch({ store, ...REQUEST });

    expect(branched.data.modelName).toBe("V3"); // the edit is applied…
    expect(branched.data.resolution).toBe(30); // …on top of the state at the cursor
    expect(branched.log).toHaveLength(3); // the two-transaction prefix + the edit
    expect(branched.cursor).toBe(3);
    expect(branched.canRedo).toBe(false); // the source's redo tail is not carried
    expect(branched.log[2]).toMatchObject({
      revision: 3,
      nodeId: "user-edit",
      primary: [PENDING],
    });

    expect(link).toEqual({ isCopy: true, parentModelId: 12, groupId: 7 });
  });

  it("leaves the source session bit-identical", () => {
    const store = session();
    const before = {
      data: fingerprint(store.data),
      logLength: store.log.length,
      cursor: store.cursor,
      canRedo: store.canRedo,
      revisions: store.log.map((transaction) => transaction.revision),
    };

    branch({ store, ...REQUEST });

    expect(fingerprint(store.data)).toBe(before.data);
    expect(store.data.modelName).toBe("V1"); // the branch's edit did not leak into the source
    expect(store.log).toHaveLength(before.logLength);
    expect(store.cursor).toBe(before.cursor);
    expect(store.canRedo).toBe(before.canRedo);
    expect(store.log.map((transaction) => transaction.revision)).toEqual(before.revisions);
  });

  it("replays its own diffs — loading a branch needs no parent", () => {
    const store = session();
    const { store: branched } = branch({ store, ...REQUEST });

    const artefact = toArtefact({ store: branched, workflow: WORKFLOW, modelId: 99 });
    const { store: loaded, divergence } = fromArtefact(artefact);

    expect(divergence).toBeUndefined();
    expect(artefact.discarded).toEqual([]); // the source's tail never came along
    expect(artefact.log.map((transaction) => transaction.revision)).toEqual([1, 2, 3]);
    expect(loaded.data).toEqual(branched.data);
    expect(loaded.cursor).toBe(3);
  });

  it("keeps branching available mid-flow, not only at the end", () => {
    const store = createStore(seed());
    store.applyTransaction([{ op: "replace", path: "/resolution", prev: 60, next: 15 }], [], {
      node: { id: "settings" },
    });
    store.undo();
    store.undo(); // back to the very start: the prefix is empty

    const { store: branched } = branch({ store, ...REQUEST });

    expect(branched.log).toHaveLength(1);
    expect(branched.log[0].nodeId).toBe("user-edit");
    expect(branched.data.modelName).toBe("V3");
  });

  it("names the family without copying it", () => {
    const store = session();

    const { link } = branch({ store, ...REQUEST });

    expect(Object.keys(link).sort()).toEqual(["groupId", "isCopy", "parentModelId"]);
  });
});
