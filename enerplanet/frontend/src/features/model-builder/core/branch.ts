/**
 * Branching — the "New Model" choice at the prompt (case T17).
 *
 * A branch is **full duplex**: it carries a copy of the projection at the cursor, a copy of the log
 * *prefix* that produced it, and the pending change as its own first transaction — while the source
 * session is left bit-identical. Nothing is shared and nothing is referenced, so the branch replays
 * its own diffs and loads without its parent (`Plan.md` §9).
 *
 * What does *not* come along is the source's redo tail. A branch has no discard stack: the tail is
 * the source's business, and carrying it would let a branch undo work it never did.
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
  /** Downstream values it invalidates, when the caller has staged it (T7). */
  cascade?: readonly DiffOp[];
  /** The node that produced the edit, when it came from one. */
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
   * branch whose redo derives no cascade. `restore` is this function's own and cannot be passed in.
   */
  options?: StoreOptions;
}

export interface BranchResult {
  /** The new session, working, and ready to persist once the backend gives it an id. */
  store: Store;
  link: BranchLink;
}

export function branch({ store, parent, pending, options }: BranchRequest): BranchResult {
  // The branch starts where the source sits: its state at the cursor, and the log prefix that
  // produced it. Both are copied — a branch shares nothing with the session it came from.
  //
  // Slicing at the cursor is intent, not the guard: `applyTransaction` below truncates any tail
  // itself (T1), so passing the whole log would land in the same place. Saying "the prefix" here
  // means the branch does not depend on that happening.
  const prefix = store.log.slice(0, store.cursor);
  const session = createStore(structuredClone(store.initial), {
    ...options,
    restore: {
      projection: structuredClone(store.data),
      log: prefix,
      cursor: store.cursor,
    },
  });

  // The edit the prompt was holding becomes the branch's first transaction. Sealed against the
  // branch's own tip, so none of the source's discarded work can be resurrected here.
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
