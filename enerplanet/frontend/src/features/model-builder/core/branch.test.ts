/**
 * Branching — "New Model" at the prompt.
 *
 * v2 model (`spec/history-v2.md` §1): the log is **append-only** and has no redo tail, so a branch
 * takes the **whole log** as it stands — there is no cursor to slice at and no discard stack to
 * leave behind. A branch is still full duplex: a copy of the projection, the log, and the pending
 * change as its own first commit, while the source session is left bit-identical.
 *
 * Written failing first against the new design.
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

/** A session with three commits. */
function session(): ReturnType<typeof createStore> {
  const store = createStore(seed());
  store.applyTransaction(
    [{ op: "replace", path: MODEL_NAME_PATH, prev: "Contract fixture", next: "V1" }],
    [],
    { node: { id: "model-start", moduleId: "model-start" } },
  );
  store.applyTransaction([{ op: "replace", path: "/resolution", prev: 60, next: 30 }], [], {
    node: { id: "settings", moduleId: "settings" },
  });
  store.applyTransaction([{ op: "replace", path: MODEL_NAME_PATH, prev: "V1", next: "V2" }], [], {
    node: { id: "rename", moduleId: "rename" },
  });
  return store;
}

const REQUEST = {
  parent: { modelId: 12, groupId: 7 },
  pending: { primary: [PENDING], node: { id: "user-edit", moduleId: "user-edit" } },
} as const;


describe("branch = state + log + the pending change", () => {
  it("starts where the source sits, plus the pending change, carrying the whole log", () => {
    const store = session();

    const { store: branched, link } = branch({ store, ...REQUEST });

    expect(branched.data.modelName).toBe("V3"); // the edit is applied…
    expect(branched.data.resolution).toBe(30); // …on top of the source's state
    expect(branched.log).toHaveLength(4); // the three-commit log + the edit
    expect(branched.log[3]).toMatchObject({
      revision: 4,
      node: { id: "user-edit", moduleId: "user-edit" },
      primary: [PENDING],
    });

    expect(link).toEqual({ isCopy: true, parentModelId: 12, groupId: 7 });
  });

  it("leaves the source session bit-identical", () => {
    const store = session();
    const before = {
      data: fingerprint(store.data),
      logLength: store.log.length,
      revisions: store.log.map((commit) => commit.revision),
    };

    branch({ store, ...REQUEST });

    expect(fingerprint(store.data)).toBe(before.data);
    expect(store.data.modelName).toBe("V2"); // the branch's edit did not leak into the source
    expect(store.log).toHaveLength(before.logLength);
    expect(store.log.map((commit) => commit.revision)).toEqual(before.revisions);
  });

  it("replays its own diffs — loading a branch needs no parent", () => {
    const store = session();
    const { store: branched } = branch({ store, ...REQUEST });

    const artefact = toArtefact({ store: branched, workflow: WORKFLOW, flow: [], modelId: 99 });
    const { store: loaded, divergence } = fromArtefact(artefact);

    expect(divergence).toBeUndefined();
    expect(artefact.log.map((commit) => commit.revision)).toEqual([1, 2, 3, 4]);
    expect(loaded.data).toEqual(branched.data);
  });

  it("keeps branching available mid-flow, not only at the end", () => {
    const store = createStore(seed());
    store.applyTransaction([{ op: "replace", path: "/resolution", prev: 60, next: 15 }], [], {
      node: { id: "settings", moduleId: "settings" },
    });

    const { store: branched } = branch({ store, ...REQUEST });

    expect(branched.log).toHaveLength(2);
    expect(branched.log[1].node?.id).toBe("user-edit");
    expect(branched.data.modelName).toBe("V3");
  });

  it("names the family without copying it", () => {
    const store = session();

    const { link } = branch({ store, ...REQUEST });

    expect(Object.keys(link).sort()).toEqual(["groupId", "isCopy", "parentModelId"]);
  });
});
