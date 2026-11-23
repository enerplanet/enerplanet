/**
 * Branching — the "New Model" choice at the prompt.
 *
 * A branch is **full duplex**: it carries a copy of the projection, a copy of the log, and the
 * pending change as its own first commit — while the source session is left bit-identical.
 * Nothing is shared and nothing is referenced, so the branch replays its own diffs and loads
 * without its parent.
 *
 * With v2 the log is **append-only and has no redo tail** (§1), so there is no prefix to slice at
 * a cursor and no discard stack to leave behind: the branch takes the whole log as it stands. An
 * undo is a rollback commit like any other, so it travels with the log rather than being a
 * transient the branch must not inherit.
 *
 * The core stays free of the model record: `POST /api/models` creates and names the new model, and
 * the caller snapshots the artefact once it has the id. What this returns is the session, plus the
 * family link the backend records.
 */

import type { DiffOp } from "./diff";
import type { NodeRef } from "./module";
import { createStore, type Store, type StoreOptions } from "./store";

/** The edit the prompt was holding when the branch was chosen. */
export interface PendingEdit {
  /** What the user changed. */
  primary: readonly DiffOp[];
  /** Downstream values it invalidates, when the caller has staged it. */
  cascade?: readonly DiffOp[];
  /** The placement that produced the edit, when it came from one. */
  node?: NodeRef;
}

/** The family link the backend records — `POST /api/models` takes exactly these. */
export interface BranchLink {
  isCopy: true;
  parentModelId?: number;
  groupId?: number;
}

export interface BranchRequest {
  /** The session being branched from. Left untouched. */
  store: Store;
  /** The source model's family identity, as the backend knows it. */
  parent: { modelId?: number; groupId?: number };
  pending: PendingEdit;
  /**
   * The branch session's own store options — the invalidation seam (`deriveCascade`) above all.
   * It is a function, so it cannot be copied out of the source; a caller that omits it gets a
   * branch whose seals derive no cascade. `restore` is this function's own and cannot be passed in.
   */
  options?: StoreOptions;
}

export interface BranchResult {
  /** The new session, working, and ready to persist once the backend gives it an id. */
  store: Store;
  link: BranchLink;
}

export function branch({ store, parent, pending, options }: BranchRequest): BranchResult {
  // The branch starts where the source sits: its current state, and the whole log that produced
  // it. Both are copied — a branch shares nothing with the session it came from.
  const session = createStore(structuredClone(store.initial), {
    ...options,
    restore: {
      projection: structuredClone(store.data),
      log: store.log,
    },
  });

  // The edit the prompt was holding becomes the branch's first commit, appended at the branch's
  // own tip.
  session.applyTransaction(pending.primary, pending.cascade ?? [], { node: pending.node });

  return {
    store: session,
    link: {
      isCopy: true,
      ...(parent.modelId === undefined ? {} : { parentModelId: parent.modelId }),
      ...(parent.groupId === undefined ? {} : { groupId: parent.groupId }),
    },
  };
}
