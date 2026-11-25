/**
 * Branching — the "New Model" choice at the prompt: a full-duplex copy of the projection and log,
 * with the pending edit as its own first commit.
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
  /** The branch session's own store options — the invalidation seam above all. */
  options?: StoreOptions;
}

export interface BranchResult {
  /** The new session, working, and ready to persist once the backend gives it an id. */
  store: Store;
  link: BranchLink;
}

export function branch({ store, parent, pending, options }: BranchRequest): BranchResult {
  // The branch starts where the source sits: its current state and the whole log.
  const session = createStore(structuredClone(store.initial), {
    ...options,
    restore: {
      projection: structuredClone(store.data),
      log: store.log,
    },
  });

  // The held edit becomes the branch's first commit.
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
