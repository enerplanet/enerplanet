/**
 * The edit-while-behind prompt — editing while the session is off the tip (a redo available) raises
 * the question, because sealing an edit here is a one-way step. `needsPrompt` is just "is a redo
 * available"; the three outcomes are `discard-redo`, `new-model` and `cancel`.
 */

import { applyDiffs } from "./diff";
import { branch, type BranchLink, type PendingEdit } from "./branch";
import type { ModelData } from "./ports";
import type { Store, StoreOptions } from "./store";

/** The only ways a pending edit may proceed while a redo is available to lose. */
export type EditChoice = "discard-redo" | "new-model" | "cancel";

/** Whether the shell must ask before sealing. */
export function needsPrompt(store: Store): boolean {
  return store.canRedo;
}

export interface EditRequest {
  store: Store;
  choice: EditChoice;
  pending: PendingEdit;
  /**
   * The source model's family identity, needed only by `new-model`.
   */
  parent?: { modelId?: number; groupId?: number };
  /** The branch session's own store options — the invalidation seam above all. */
  options?: StoreOptions;
}

export interface EditResolution {
  /** The session the shell keeps working in: the source for two choices, the branch for one. */
  store: Store;
  /** Set by `new-model` — what the copy request and the family bookkeeping need. */
  link?: BranchLink;
  /** True only for `cancel`: nothing was written, so the shell re-renders from `store.data`. */
  unchanged: boolean;
}

export function resolveEdit({
  store,
  choice,
  pending,
  parent,
  options,
}: EditRequest): EditResolution {
  switch (choice) {
    case "discard-redo": {
      // Continuing here: the edit is appended at the tip, which is what takes the redo away.
      store.applyTransaction(pending.primary, pending.cascade ?? [], { node: pending.node });
      return { store, unchanged: false };
    }

    case "new-model": {
      const branched = branch({ store, parent: parent ?? {}, pending, options });
      return { store: branched.store, link: branched.link, unchanged: false };
    }

    case "cancel":
      return { store, unchanged: true };
  }
}

/** The model as the user sees it: the session state with the pending edit and any staged cascade applied, without sealing. */
export function previewOf(store: Store, pending: PendingEdit): ModelData {
  return applyDiffs(applyDiffs(store.data, pending.primary), pending.cascade ?? []);
}
