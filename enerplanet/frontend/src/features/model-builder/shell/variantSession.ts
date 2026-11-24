/**
 * The fork's own session — the shell's half of `model-variant`'s switch.
 *
 * The module commits the switch (moving the store's `modelId` onto the copy); the shell writes the copy's
 * own session row, keyed by the variant's model id. `createVariantSessionGuard` makes the write once per fork.
 */

import { toArtefact, type WorkflowRef } from "../core/artefact";
import type { Flow } from "../core/flow";
import type { Store } from "../core/store";
import type { ModelGateway } from "../save/gateway";

/** A fork this session made, whose row the shell owes. */
export interface VariantSessionPlan {
  /** The copy's model id — the row's key. */
  variantModelId: number;
}

/** The idempotency `variantSessionFor`'s caller reads: which fork, if any, this session now owes. */
export interface VariantSessionGuard {
  /** The fork this session owes a row for, or `undefined`. */
  claim(store: Store): VariantSessionPlan | undefined;
}

export function createVariantSessionGuard(): VariantSessionGuard {
  let store: Store | null = null;
  let variantId: number | null = null;

  return {
    claim(next) {
      const variant = next.data.modelVariant;

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
  /** The session's placed flow — what the artefact carries (`core/artefact.ts`). */
  flow: Flow;
  /** The copy's model id — the row's key, and the model the artefact names. */
  variantModelId: number;
}

/**
 * Build the fork's session row from the live store — the switch included — and store it.
 *
 * @throws whatever the gateway throws — the caller reports it.
 */
export async function persistVariantSession(request: VariantSessionRequest): Promise<void> {
  const { gateway, store, workflow, flow, variantModelId } = request;
  const artefact = toArtefact({ store, workflow, flow, modelId: variantModelId });
  await gateway.saveSession(variantModelId, artefact, workflow);
}
