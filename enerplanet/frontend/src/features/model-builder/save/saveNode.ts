/**
 * The `model-save` node (case T13) — the flow's last step, and the only node that talks to the
 * backend.
 *
 * The engine's contract is unchanged: the node reads and writes ports through its `ModuleCtx`, and a
 * throw seals nothing. What is unusual here is that the *work* is a save, so the factory is handed the
 * live `Store` as well as the gateway — a module context sees ports, not the transaction log, and the
 * artefact that Call B writes is built from the log. Keeping that here rather than widening
 * `ModuleCtx` means no other module can see history either.
 *
 * A refusal (no name, no assessment period, no drawn area) throws `SaveRefused`: the engine then seals
 * nothing, and the shell shows why. `modelId` and `saveResult` are read before they are written,
 * because on a re-save they already exist and the write boundary refuses a blind overwrite.
 */

import type { WorkflowRef } from "../core/artefact";
import type { Flow, ModuleRegistry } from "../core/flow";
import { defineModule, type Module } from "../core/module";
import type { Store } from "../core/store";
import type { ModelGateway } from "./gateway";
import { saveModel, type SaveRefusal } from "./saveModel";

const REFUSAL_REASONS: Record<SaveRefusal, string> = {
  "missing-name": "the model has no name yet",
  "missing-dates": "the assessment period is not set",
  "missing-coordinates": "no area has been drawn",
};

/** Thrown when the flow cannot be saved yet. The engine seals no transaction when a run throws. */
export class SaveRefused extends Error {
  readonly reason: SaveRefusal;

  constructor(reason: SaveRefusal) {
    super(`[model-builder] cannot save: ${REFUSAL_REASONS[reason]}`);
    this.name = "SaveRefused";
    this.reason = reason;
  }
}

export interface SaveNodeOptions {
  gateway: ModelGateway;
  /** The live session — see the file comment for why this node gets it. */
  store: Store;
  workflow: WorkflowRef;
  /** Needed for the completeness decision: a finished flow saves as `draft`, not `incomplete`. */
  flow: Flow;
  registry: ModuleRegistry;
  /** The node's id in the flow. Defaults to `model-save`. */
  id?: string;
}

export function createSaveNode(options: SaveNodeOptions): Module {
  return defineModule({
    id: options.id ?? "model-save",
    // The whole persisted surface, declared. `coordinates` is required because the backend resolves
    // the country from it and refuses a model without it — so the flow gate keeps this node
    // unplaceable, and the runtime gate keeps it un-runnable, until an area exists.
    params: [
      { port: "modelName" },
      { port: "fromDate" },
      { port: "toDate" },
      { port: "resolution" },
      { port: "workspaceId" },
      { port: "coordinates", required: true },
      { port: "buildings" },
      { port: "lines" },
      { port: "mvLines" },
      { port: "transformers" },
      { port: "grids" },
      { port: "advancedParams" },
      { port: "draftId" },
      { port: "userId" },
      { port: "modelId" },
      { port: "saveResult" },
    ],
    affect: {},
    layout: [],

    run: async (ctx) => {
      const outcome = await saveModel(options.gateway, {
        store: options.store,
        workflow: options.workflow,
        flow: options.flow,
        registry: options.registry,
        modelId: options.store.data.modelId,
        draftId: options.store.data.draftId,
        userId: options.store.data.userId,
      });

      if (!outcome.ok) throw new SaveRefused(outcome.reason);

      // Read-then-write: both ports are already populated on a re-save, and the write boundary
      // refuses to overwrite a value the module never looked at.
      ctx.read("modelId");
      ctx.read("saveResult");
      ctx.commit({
        modelId: outcome.modelId,
        saveResult: { modelId: outcome.modelId, created: outcome.created },
      });
    },

    validate: () => [],
  });
}
