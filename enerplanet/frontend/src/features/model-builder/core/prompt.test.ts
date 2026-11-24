/**
 * The edit-while-behind prompt: `needsPrompt` is "is a redo available", and `discard-redo` appends
 * the edit rather than dropping a tail.
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
  node: { id: "user-edit", moduleId: "user-edit" },
} as const;

const PARENT = { modelId: 12, groupId: 7 };

/** Three commits, plus a rollback: editing here is what raises the prompt. */
function session(): ReturnType<typeof createStore> {
  const store = createStore(seed());
  store.applyTransaction(
    [{ op: "replace", path: MODEL_NAME, prev: "Contract fixture", next: "V1" }],
    [],
    { node: { id: "model-start", moduleId: "model-start" } },
  );
  store.applyTransaction([{ op: "replace", path: RESOLUTION, prev: 60, next: 30 }], [], {
    node: { id: "settings", moduleId: "settings" },
  });
  store.applyTransaction([{ op: "replace", path: MODEL_NAME, prev: "V1", next: "V2" }], [], {
    node: { id: "rename", moduleId: "rename" },
  });
  store.undo(); // appends a rollback — something is redoable, so the prompt applies
  return store;
}


describe("the edit-while-behind prompt", () => {
  it("asks only when there is something to redo", () => {
    const store = createStore(seed());
    expect(needsPrompt(store)).toBe(false);

    store.applyTransaction([{ op: "replace", path: RESOLUTION, prev: 60, next: 30 }], [], {
      node: { id: "settings", moduleId: "settings" },
    });
    expect(needsPrompt(store)).toBe(false);

    store.undo();
    expect(needsPrompt(store)).toBe(true);
  });

  it("discard-redo appends the edit — nothing in the log is lost", () => {
    const store = session();
    const before = store.log.length; // three commits + a rollback

    const resolution = resolveEdit({ store, choice: "discard-redo", pending: PENDING });

    expect(resolution.unchanged).toBe(false);
    expect(resolution.link).toBeUndefined();
    expect(resolution.store).toBe(store); // the same session, moved on
    expect(store.data.modelName).toBe("V3");
    expect(store.log).toHaveLength(before + 1); // the edit is appended, nothing discarded
    expect(store.log[before].node?.id).toBe("user-edit");
    expect(store.log[before].primary).toEqual(PENDING.primary);
  });

  it("new-model leaves the source intact and hands back a branch with its link", () => {
    const store = session();
    const before = { data: fingerprint(store.data), log: store.log.length };

    const resolution = resolveEdit({ store, choice: "new-model", pending: PENDING, parent: PARENT });

    // The source session is untouched: same state, same log.
    expect(fingerprint(store.data)).toBe(before.data);
    expect(store.log).toHaveLength(before.log);

    // The branch carries the edit, and the family link the copy request needs.
    expect(resolution.store).not.toBe(store);
    expect(resolution.store.data.modelName).toBe("V3");
    expect(resolution.store.log).toHaveLength(before.log + 1);
    expect(resolution.link).toEqual({ isCopy: true, parentModelId: 12, groupId: 7 });
  });

  it("cancel changes nothing at all", () => {
    const store = session();
    const before = {
      data: fingerprint(store.data),
      canRedo: store.canRedo,
      revisions: store.log.map((commit) => commit.revision),
    };

    const resolution = resolveEdit({ store, choice: "cancel", pending: PENDING });

    expect(resolution.unchanged).toBe(true);
    expect(fingerprint(store.data)).toBe(before.data);
    expect(store.data.modelName).toBe("V1"); // the pending change was not applied…
    expect(store.log).toHaveLength(before.revisions.length); // …and nothing was sealed
    expect(store.canRedo).toBe(before.canRedo);
    expect(store.log.map((commit) => commit.revision)).toEqual(before.revisions);
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


describe("saving before the copy must not seal", () => {
  it("previews the model as the user sees it, without touching the session", () => {
    const store = session();
    const before = { data: fingerprint(store.data), log: store.log.length };

    const payload = previewOf(store, PENDING);

    // The payload the save and the copy send carries the edit…
    expect(payload.modelName).toBe("V3");
    // …while the session is exactly as it was.
    expect(fingerprint(store.data)).toBe(before.data);
    expect(store.log).toHaveLength(before.log);
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
