/**
 * The fork's own session — the shell's half of `model-variant`'s switch.
 *
 * The **module** commits the switch: running it writes the copy's record (`modelVariant`) and moves the store's
 * `modelId` onto the copy, in one transaction (`modules/model-variant/index.tsx`). Committing `modelId` *is* the
 * switch — the frame renders that one store and no page is navigated — but the copy is a model of its own, and a
 * model with a builder session needs a row of its own (`model_sessions`, keyed by the model id). This is that
 * row: keyed by the **variant's** model id, its log the session's log including the switch, its projection the
 * store as it stands after the switch, its fingerprint recomputed over that projection.
 *
 * **Why the shell writes it, and why not inside `run()`.** The row is a snapshot of a session *after* the switch
 * has landed, and the switch is not in the log until the run's transaction seals (`core/engine.ts` seals at the
 * end of `run()`). A write from inside `run()` would snapshot a store that does not yet carry the switch. The
 * shell owns the session and already has the artefact builder and the session PUT (`save/saveModel.ts`,
 * `save/httpGateway.ts`), so the shell is where the row is built: the module states *what happened* — the record
 * present, `modelId` moved — and the shell persists the consequence. The trigger is derivable from the store for
 * the same reason: the `modelVariant` record **appearing** is the fork.
 *
 * **Why it cannot double-fire.** `createVariantSessionGuard` is the idempotency, keyed on two things: the store
 * it is looking at, and the variant it has already owed. A session that *arrived* with a variant recorded (a
 * load, a reset, a mode switch) is not a fork this page made, so the guard adopts what it carries as already
 * owed and claims nothing; and a fork is claimed **exactly once**, so a re-render, another store change, or
 * StrictMode's double-invoke never write a second time. The claim is taken *before* the write (the pattern the
 * `?model=` load uses), so a failure is reported rather than retried — and recovering is an ordinary save of the
 * same model, which upserts the same row by the same key.
 *
 * **Why the fingerprint is not the trap here.** `toArtefact` recomputes the fingerprint over the projection it
 * snapshots, and that projection is the live store's own `data` — the state the log replays to. So the row is
 * self-consistent by construction and `fromArtefact` finds `stored === actual` and trusts it. The trap this must
 * not walk into is patching a *copied* projection and leaving the old fingerprint, which the loader discards and
 * replays away (`core/artefact.ts:125-136`); there is deliberately no copy to patch.
 */

import { toArtefact, type WorkflowRef } from "../core/artefact";
import type { Store } from "../core/store";
import type { ModelGateway } from "../save/gateway";

/** A fork this session made, whose row the shell owes. */
export interface VariantSessionPlan {
  /** The copy's model id — the row's key. */
  variantModelId: number;
}

/** The idempotency `variantSessionFor`'s caller reads: which fork, if any, this session now owes. */
export interface VariantSessionGuard {
  /**
   * The fork this session owes a row for, or `undefined`.
   *
   * Claims a fork the first time its record appears on the store the guard is watching, and nothing after that.
   * A store it has not seen before is a new session (a load, a reset, a mode switch): whatever variant it
   * arrived carrying is treated as already rowed, and it claims nothing.
   */
  claim(store: Store): VariantSessionPlan | undefined;
}

export function createVariantSessionGuard(): VariantSessionGuard {
  let store: Store | null = null;
  let variantId: number | null = null;

  return {
    claim(next) {
      const variant = next.data.modelVariant;

      // A different store is a different session: nothing is owed for what it arrived with. A session that
      // already holds a variant is one whose row exists (or will be written by its own save) — never a fork
      // this page just made.
      if (store !== next) {
        store = next;
        variantId = variant?.variantModelId ?? null;
        return undefined;
      }

      // Nothing recorded yet, or a variant this session has already owed.
      if (variant === undefined || variant.variantModelId === variantId) return undefined;

      variantId = variant.variantModelId;
      return { variantModelId: variant.variantModelId };
    },
  };
}

export interface VariantSessionRequest {
  gateway: ModelGateway;
  /** The live session, read *after* the switch has sealed. */
  store: Store;
  workflow: WorkflowRef;
  /** The copy's model id — the row's key, and the model the artefact names. */
  variantModelId: number;
}

/**
 * Build the fork's session row from the live store — the switch included — and store it.
 *
 * The artefact is `toArtefact`'s, over the whole session: `initial`, the applied log (the switch transaction is
 * its last entry), the projection as it stands, and a fingerprint recomputed over that projection. It is PUT by
 * the same gateway call the save path uses (`saveSession` → `PUT /models/:id/session`), keyed by the variant.
 *
 * @throws whatever the gateway throws — the caller reports it; nothing local is left half-written, because there
 *         is nothing local to write.
 */
export async function persistVariantSession(request: VariantSessionRequest): Promise<void> {
  const { gateway, store, workflow, variantModelId } = request;
  const artefact = toArtefact({ store, workflow, modelId: variantModelId });
  await gateway.saveSession(variantModelId, artefact, workflow);
}
