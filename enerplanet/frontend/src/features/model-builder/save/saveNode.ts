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
 * **The flow and the registry are getters, not values**, and that is not a stylistic choice: this node
 * is *part of* both. The frame builds a workflow and this node has to close over the very structures it
 * appears in, so the caller passes `() => …` and fills them in once the workflow exists — the same
 * late-binding shape the map provider and the grid engine use, for the same reason.
 *
 * A refusal (no name, no assessment period, no drawn area) throws `SaveRefused`: the engine then seals
 * nothing, and the shell shows why. `modelId` and `saveResult` are read before they are written,
 * because on a re-save they already exist and the write boundary refuses a blind overwrite.
 */

import type { WorkflowRef } from "../core/artefact";
import type { Flow, ModuleRegistry } from "../core/flow";
import { defineModule, type Module } from "../core/module";
import { nodeStates } from "../core/position";
import type { ModelData, PortKey } from "../core/ports";
import type { Store } from "../core/store";
import type { ValidationIssue } from "../core/module";
import type { ModelGateway, SaveStatus } from "./gateway";
import { saveModel, type SaveRefusal } from "./saveModel";

const REFUSAL_REASONS: Record<SaveRefusal, string> = {
  "missing-name": "the model has no name yet",
  "missing-dates": "the assessment period is not set",
  "missing-coordinates": "no area has been drawn",
};

/**
 * Every port this node *persists*, in the order a modeller would fix them — identity, period, area, grid.
 *
 * This is the completeness gate's list, and it is deliberately wider than the hard refusal below. `validate()`
 * is a *verdict for the UI* ("ready to save" vs "missing: X, Y"): an unfinished model is still saveable as
 * `incomplete` (§6), so a missing grid must be reported, never treated as a veto.
 *
 * Three things are absent on purpose:
 * - `workspaceId` / `userId` are the *session's* identity, not something the form collects or the user can fix
 *   — the host seeds them and the backend resolves the caller from the session, so reporting them would be noise.
 * - `advancedParams` has sane defaults and nothing upstream produces it (`Modules.md` §4: it "must not gate the
 *   terminal node").
 * - `modelId` / `draftId` belong to the create/edit path, not to completeness.
 */
const PERSISTED: readonly { port: PortKey; message: string }[] = [
  { port: "modelName", message: "The model has no name." },
  { port: "fromDate", message: "The assessment period has no start date." },
  { port: "toDate", message: "The assessment period has no end date." },
  { port: "resolution", message: "The model has no resolution." },
  { port: "coordinates", message: "No area has been drawn." },
  { port: "buildings", message: "The grid has no buildings." },
  { port: "transformers", message: "The grid has no transformers." },
  { port: "lines", message: "The grid has no low-voltage lines." },
  { port: "mvLines", message: "The grid has no medium-voltage lines." },
  { port: "grids", message: "The grid has no summary." },
];

/**
 * What the model is still missing before it can be run — the spec's "ready-to-save vs *missing: X, Y*"
 * (`model-save.md`), and the literal expression of the data-awareness requirement.
 */
export function missingPorts(data: Readonly<ModelData>): ValidationIssue[] {
  return PERSISTED.filter((entry) => data[entry.port] === undefined).map(({ port, message }) => ({
    port,
    message,
  }));
}

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
  /**
   * Needed for the completeness decision: a finished flow saves as `draft`, not `incomplete`.
   * A getter, because this node appears in the flow it is handed.
   */
  flow: () => Flow;
  /** Same reason as `flow`: the node is registered in the registry it is handed. */
  registry: () => ModuleRegistry;
  /** The node's id in the flow. Defaults to `model-save`. */
  id?: string;
}

export function createSaveNode(options: SaveNodeOptions): Module {
  const nodeId = options.id ?? "model-save";

  return defineModule({
    id: nodeId,
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
      const { store, gateway } = options;
      const flow = options.flow();
      const registry = options.registry();
      const modelId = store.data.modelId;

      const outcome = await saveModel(gateway, {
        store,
        workflow: options.workflow,
        flow,
        registry,
        modelId,
        draftId: store.data.draftId,
        userId: store.data.userId,
        status: statusFor(flow, registry, store, nodeId, modelId),
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

    validate: (ctx) => missingPorts(ctx.store),
  });
}

/**
 * The status this save earns — and the reason it cannot simply be `position().complete`.
 *
 * `position` answers "the first node that is not done", and while this node runs it *is* that node, so
 * `complete` reads false on every save and a finished model could never be promoted to `draft` — which
 * is exactly what a run requires. The honest question is whether every **other** node is done.
 *
 * `incomplete` is what an unfinished model gets, and §6 lets it round-trip that way: the bar's save pins
 * `incomplete` for the same reason. A complete first save is `draft`; a complete re-save is `modified`,
 * since a model that has been through here once already exists.
 */
function statusFor(
  flow: Flow,
  registry: ModuleRegistry,
  store: Store,
  nodeId: string,
  modelId: number | undefined,
): SaveStatus {
  const states = nodeStates(flow, registry, store);
  const othersDone = flow.every((node) => node.id === nodeId || states[node.id] === "done");

  if (!othersDone) return "incomplete";
  return modelId === undefined ? "draft" : "modified";
}
