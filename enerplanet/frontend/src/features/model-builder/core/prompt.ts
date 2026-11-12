/**
 * The edit-while-behind prompt (case T19).
 *
 * The trigger is the seal itself: the **first transaction after an undo** is what raises the
 * question, because sealing is what would silently destroy the discard stack. So `needsPrompt` is
 * nothing more than "is there a tail", and the shell asks before it seals.
 *
 * There are exactly three outcomes and no fourth path — the union below is the guarantee, since a
 * switch over it has nothing left to fall through to:
 *
 * - **discard-redo** — drop the tail and continue *here* (T1 semantics: the seal truncates it);
 * - **new-model** — branch (T17) and hand the shell the family link;
 * - **cancel** — write nothing, so the shell can re-render the node from the store's own data and
 *   the redo stack keeps working.
 *
 * ## The shell's half of "new model"
 *
 * Branching a *model* is a sequence the core cannot perform, because none of it is pure. Given the
 * link this returns:
 *
 * 1. **tell the user the current model will be saved first** — the model that gets copied is the
 *    one on the server, so the current work is persisted on the way through, and `Plan.md` §8 says
 *    the user must never be surprised by what an action triggers;
 * 2. **save the current model** — `previewOf(store, pending)` is the payload. It must *not* be a
 *    transaction: `POST`/`PUT` straight from the adapter, because sealing here would eat the very
 *    discard stack this prompt exists to protect;
 * 3. **copy it into the family** — `POST /api/models` with `is_copy: true`, `parent_model_id` and
 *    `group_id`, sending the same payload. There is no separate copy endpoint; a copy is a create
 *    that names its family (`model_family.go`: *"copies record the root original in
 *    parent_model_id"*, so `parent.modelId` is the root original, not the model copied from);
 * 4. **open the copy in a new tab.** The branch session returned here is what that model's session
 *    persists (T18) once an artefact has a home server-side; until then the copy carries the model
 *    config and the new tab starts from it.
 *
 * Two consequences worth having in writing:
 *
 * - because steps 2 and 3 leave the session alone, a **failed** save or copy (Nominatim geocoding
 *   can fail) lands the user in exactly the state `cancel` would — nothing sealed, the tail intact,
 *   the pending edit still in hand. That is the spec's "the prompt must survive without losing the
 *   pending change", and it falls out rather than needing care;
 * - the new tab's session is *not* the branch store returned here unless the shell carries it over.
 *   Opening a tab is a page load; the branch store is the local session for the model that was just
 *   created, and persisting it is what makes the new tab's history match this one's.
 */

import { applyDiffs } from "./diff";
import { branch, type BranchLink, type PendingEdit } from "./branch";
import type { ModelData } from "./ports";
import type { Store, StoreOptions } from "./store";

/** The only ways a pending edit may pass a non-empty discard stack. */
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
   * The source model's family identity, needed only by `new-model`. The backend wants the **root
   * original** in `parentModelId`, not the model the user happened to be in.
   */
  parent?: { modelId?: number; groupId?: number };
  /** The branch session's own store options — the invalidation seam above all (T17). */
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
      // Continuing here: the seal truncates the tail itself (T1).
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

/**
 * The model as the user sees it: the session's state with the pending edit — and any staged cascade
 * — applied, **without sealing anything**.
 *
 * This is the payload for the save in step 2 above and the copy in step 3. Sealing instead would
 * truncate the discard stack, which is precisely what the user is still deciding about.
 */
export function previewOf(store: Store, pending: PendingEdit): ModelData {
  return applyDiffs(applyDiffs(store.data, pending.primary), pending.cascade ?? []);
}
