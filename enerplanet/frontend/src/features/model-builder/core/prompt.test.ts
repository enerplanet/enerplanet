/**
 * The edit-while-behind prompt (case T19).
 *
 * Spec: `.local/ModularThesis/spec/core.md` §F. A pending edit meeting a non-empty discard stack has
 * exactly three outcomes and no fourth path: drop the tail and continue here, branch to a new model,
 * or cancel and change nothing. The trigger is the seal itself — the first transaction after an undo
 * is what raises the question, which is why `needsPrompt` is just "is there a tail".
 *
 * The core owns the decision and the guarantees. The save/copy calls around the branch are the
 * shell's, and `previewOf` is what keeps the "save the current model first" step from sealing a
 * transaction on the very session whose tail the prompt exists to protect.
 *
 * Written failing first.
 */
import { describe, it, expect } from "vitest";
import { needsPrompt, previewOf, resolveEdit, type EditChoice } from "./prompt";
import { fingerprint } from "./fingerprint";
import { createStore } from "./store";
import { seed } from "./fixtures";

const MODEL_NAME = "/modelName";
const RESOLUTION = "/resolution";

const PENDING = {
  primary: [{ op: "replace", path: MODEL_NAME, prev: "V1", next: "V3" }],
  node: { id: "user-edit" },
} as const;

const PARENT = { modelId: 12, groupId: 7 };

/** Three transactions, sitting two in: editing here is what raises the prompt. */
function session(): ReturnType<typeof createStore> {
  const store = createStore(seed());
  store.applyTransaction(
    [{ op: "replace", path: MODEL_NAME, prev: "Contract fixture", next: "V1" }],
    [],
    { node: { id: "model-start" } },
  );
  store.applyTransaction([{ op: "replace", path: RESOLUTION, prev: 60, next: 30 }], [], {
    node: { id: "settings" },
  });
  store.applyTransaction([{ op: "replace", path: MODEL_NAME, prev: "V1", next: "V2" }], [], {
    node: { id: "rename" },
  });
  store.undo(); // cursor 2 of 3: a tail to discard
  return store;
}

// ── T19 ─────────────────────────────────────────────────────────────────────

describe("T19 — the edit-while-behind prompt", () => {
  it("asks only when there is a tail to discard", () => {
    const store = createStore(seed());
    expect(needsPrompt(store)).toBe(false);

    store.applyTransaction([{ op: "replace", path: RESOLUTION, prev: 60, next: 30 }], [], {
      node: { id: "settings" },
    });
    expect(needsPrompt(store)).toBe(false);

    store.undo();
    expect(needsPrompt(store)).toBe(true);
  });

  it("discard-redo continues here: the tail goes and the edit is sealed", () => {
    const store = session();

    const resolution = resolveEdit({ store, choice: "discard-redo", pending: PENDING });

    expect(resolution.unchanged).toBe(false);
    expect(resolution.link).toBeUndefined();
    expect(resolution.store).toBe(store); // the same session, moved on
    expect(store.data.modelName).toBe("V3");
    expect(store.log).toHaveLength(3); // the discarded revision is gone, the edit took its place
    expect(store.cursor).toBe(3);
    expect(store.canRedo).toBe(false);
    expect(store.log[2]).toMatchObject({ nodeId: "user-edit", primary: PENDING.primary });
  });

  it("new-model leaves the source intact and hands back a branch with its link", () => {
    const store = session();
    const before = { data: fingerprint(store.data), cursor: store.cursor, log: store.log.length };

    const resolution = resolveEdit({ store, choice: "new-model", pending: PENDING, parent: PARENT });

    // The source session is untouched: same state, same log, same tail, redo still available.
    expect(fingerprint(store.data)).toBe(before.data);
    expect(store.log).toHaveLength(before.log);
    expect(store.cursor).toBe(before.cursor);
    expect(store.canRedo).toBe(true);

    // The branch carries the edit, and the family link the copy request needs.
    expect(resolution.store).not.toBe(store);
    expect(resolution.store.data.modelName).toBe("V3");
    expect(resolution.store.log).toHaveLength(3);
    expect(resolution.store.canRedo).toBe(false);
    expect(resolution.link).toEqual({ isCopy: true, parentModelId: 12, groupId: 7 });
  });

  it("cancel changes nothing at all — bit-identical store and log, redo still there", () => {
    const store = session();
    const before = {
      data: fingerprint(store.data),
      cursor: store.cursor,
      canRedo: store.canRedo,
      revisions: store.log.map((transaction) => transaction.revision),
    };

    const resolution = resolveEdit({ store, choice: "cancel", pending: PENDING });

    expect(resolution.unchanged).toBe(true);
    expect(fingerprint(store.data)).toBe(before.data);
    expect(store.data.modelName).toBe("V1"); // the pending change was not applied…
    expect(store.log).toHaveLength(before.revisions.length); // …and nothing was sealed
    expect(store.cursor).toBe(before.cursor);
    expect(store.canRedo).toBe(before.canRedo);
    expect(store.log.map((transaction) => transaction.revision)).toEqual(before.revisions);
  });

  it("gives every choice exactly one outcome — there is no fourth path", () => {
    const choices: EditChoice[] = ["discard-redo", "new-model", "cancel"];

    for (const choice of choices) {
      const resolution = resolveEdit({
        store: session(),
        choice,
        pending: PENDING,
        parent: PARENT,
      });

      expect(resolution).toBeDefined();
      expect(typeof resolution.unchanged).toBe("boolean");
    }
  });
});

describe("T19 — saving before the copy must not seal", () => {
  it("previews the model as the user sees it, without touching the session", () => {
    const store = session();
    const before = { data: fingerprint(store.data), log: store.log.length, cursor: store.cursor };

    const payload = previewOf(store, PENDING);

    // The payload the save and the copy send carries the edit…
    expect(payload.modelName).toBe("V3");
    // …while the session is exactly as it was, tail included. Sealing here would eat the very
    // discard stack this prompt exists to protect.
    expect(fingerprint(store.data)).toBe(before.data);
    expect(store.log).toHaveLength(before.log);
    expect(store.cursor).toBe(before.cursor);
    expect(store.canRedo).toBe(true);
  });

  it("applies a staged cascade too, so the saved config holds no stale values", () => {
    const store = session();
    const staged = {
      primary: [{ op: "replace" as const, path: MODEL_NAME, prev: "V1", next: "V3" }],
      cascade: [{ op: "remove" as const, path: RESOLUTION, prev: 30 }],
    };

    const payload = previewOf(store, staged);

    expect(payload.modelName).toBe("V3");
    expect(payload.resolution).toBeUndefined();
    expect(store.data.resolution).toBe(30); // the session's own state is untouched
  });
});
