/**
 * The `model-save` node (case T13) — the flow's last step, and the only node that talks to the
 * backend.
 *
 * The engine's contract is unchanged: the node reads and writes ports through its `ModuleCtx`, and a
 * throw seals nothing. What is unusual here is that the *work* is a save, so the node is handed the
 * **live session** as well as the gateway — a module context sees ports, not the transaction log, and the
 * artefact that Call B writes is built from the log. Keeping that here rather than widening `ModuleCtx`
 * means no other module can see history either.
 *
 * **The session is a getter, and it may be absent.** This node is *part of* the flow and registry it
 * needs, so there is no order in which a caller can hand it values: the workflow has to be built around
 * the node, so the node is created first and reads the session when it runs — the same late binding the
 * map provider and the grid engine use, for the same reason. `null` means the host has not bound a session
 * yet: the node is still *declared* (so the flow validates and its `required` gate holds), but running it
 * fails loudly rather than acting on a session that is not there.
 *
 * A refusal (no name, no assessment period, no drawn area) throws `SaveRefused`: the engine then seals
 * nothing, and the shell shows why. `modelId` and `saveResult` are read before they are written, because on
 * a re-save they already exist and the write boundary refuses a blind overwrite.
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

/** Everything the node needs from the running host — one object, read when the node runs. */
export interface SaveSession {
  gateway: ModelGateway;
  /** The live store: the projection to save, and the log the artefact is built from. */
  store: Store;
  /** The session's workflow reference — what the artefact points at instead of copying. */
  workflow: WorkflowRef;
  /** Needed for the completeness decision: a finished flow saves as `draft`, not `incomplete`. */
  flow: Flow;
  registry: ModuleRegistry;
  /**
   * The workspace the model is created in, and who made it — read from the *live* host rather than the store.
   *
   * They are the session's identity, not something a module collects (`model-start` declares both ports and
   * never writes them). The store carries them too, seeded when the session started, but a workspace that
   * loads asynchronously can arrive after that: a model created with a null workspace is invisible in the
   * dashboard, which lists models *within* one. Supplied here, the value is whatever is true at save time,
   * and the stored one is the fallback.
   */
  workspaceId?: number;
  userId?: string;
}

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

/**
 * Thrown when the node runs before a host bound a session to it.
 *
 * This is the honest failure for a *declared but unbound* node: the flow is valid, the completeness gate
 * works, and nothing has told the node where to save. Better a named error than a save against a session
 * that does not exist.
 */
export class NoSessionBound extends Error {
  constructor() {
    super(
      "[model-builder] model-save has no session bound — the host must bind one before this node can run",
    );
    this.name = "NoSessionBound";
  }
}

export interface SaveNodeOptions {
  /** The live session, read at run time. See the file comment for why it is a getter and may be null. */
  session: () => SaveSession | null;
  /** The node's id in the flow. Defaults to `model-save`. */
  id?: string;
}

/**
 * The two ports this node records for a save, as a function of what Call A returned.
 *
 * A single definition, used twice: handed to `saveModel` as the `record` it folds into the artefact Call B
 * writes, and then applied to the outcome for the commit into the live store. They must be the *same* values —
 * the store's copy is what makes the node `done` and what a later save would persist, while the artefact's copy
 * is what a reload reads before the node has ever re-run — so they are produced by one function rather than
 * written out twice and left to drift.
 */
function recordSave(modelId: number, created: boolean): Partial<ModelData> {
  return { modelId, saveResult: { modelId, created } };
}

export function createSaveNode(options: SaveNodeOptions): Module {
  const nodeId = options.id ?? "model-save";

  return defineModule({
    id: nodeId,
    name: "Model save",
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
    // The node *is* the module here, so the regions its UI mounts into are declared here too: the
    // sidebar carries the verdict, the payload and the save action; the status strip carries one line.
    layout: ["sidebar", "bottom"],
    // Explicit rather than absent: the engine's default is `at-completion`, and this node has a reason to
    // differ. Its record of the save (`modelId`/`saveResult`) has to be **sealed** before the session is
    // persisted, or the artefact describes a save whose own entry is missing from its log — the node then reads
    // `pending` on every reload and the flow reads incomplete. `at-completion` buffers the commit until `run`
    // returns, which is after the save; `per-commit` seals it where it happens. Its history is unchanged either
    // way: it commits once, and the end-of-run flush adds nothing to a run that already sealed.
    seal: "per-commit",

    run: async (ctx) => {
      const session = options.session();
      if (session === null) throw new NoSessionBound();

      const { store, gateway, flow, registry } = session;
      const modelId = store.data.modelId;

      const outcome = await saveModel(gateway, {
        store,
        workflow: session.workflow,
        flow,
        registry,
        modelId,
        draftId: store.data.draftId,
        // Live first, stored second: the host knows the current workspace, the store knows what the session
        // started with. See `SaveSession`.
        workspaceId: session.workspaceId ?? store.data.workspaceId,
        userId: session.userId ?? store.data.userId,
        status: statusFor(flow, registry, store, nodeId, modelId),
        /**
         * The node's own record of the save, committed **between Call A and the artefact** — the save's seam.
         *
         * Both values are Call A's product, so this is the earliest moment they exist; and committing them into
         * the store by then is what puts them in the projection *and* the log of the save that first writes
         * them. Committing after the save instead records a save that was already written without them.
         */
        onCreated: (createdId, created) => {
          // Read-then-write: both ports are already populated on a re-save, and the write boundary refuses to
          // overwrite a value the module never looked at.
          ctx.read("modelId");
          ctx.read("saveResult");
          ctx.commit(recordSave(createdId, created));
        },
      });

      if (!outcome.ok) throw new SaveRefused(outcome.reason);
      // Nothing left to commit: the record was written into the store before the session was persisted, which
      // is what makes the stored artefact agree with the live store on where this node stands.
    },

    validate: (ctx) => missingPorts(ctx.store),
  });
}

/**
 * The status this save earns — and the reason it cannot simply be `position().complete`.
 *
 * `position` answers "the first node that is not done", and while this node runs it *is* that node, so
 * `complete` reads false on every save and a finished model could never be promoted to `draft` — which is
 * exactly what a run requires. The honest question is whether every **other** node is done.
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
