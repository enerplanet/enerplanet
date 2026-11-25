/**
 * The `model-save` node — the flow's last step, and the only node that talks to the backend.
 *
 * The node reads and writes ports through its `ModuleCtx`, and a throw seals nothing. Its work is a save,
 * so it is handed the live session (as a getter, which may be `null` until the host binds one) as well as
 * the gateway. A refusal (no name, no assessment period, no drawn area) throws `SaveRefused`, and the
 * engine seals nothing.
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
  /** The workspace the model is created in, and who made it — read from the live host, not the store. */
  workspaceId?: number;
  userId?: string;
}

/** Every port this node persists, in the order a modeller would fix them (the completeness gate's list). */
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

/** What the model is still missing before it can be run. */
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

/** Thrown when the node runs before a host bound a session to it. */
export class NoSessionBound extends Error {
  constructor() {
    super(
      "[model-builder] model-save has no session bound — the host must bind one before this node can run",
    );
    this.name = "NoSessionBound";
  }
}

export interface SaveNodeOptions {
  /** The live session, read at run time as a getter (it may be `null` until the host binds one). */
  session: () => SaveSession | null;
  /** The node's id in the flow. Defaults to `model-save`. */
  id?: string;
}

/** The two ports this node records for a save, produced once so the store's copy and the artefact's agree. */
function recordSave(modelId: number, created: boolean): Partial<ModelData> {
  return { modelId, saveResult: { modelId, created } };
}

/**
 * The configuration the node persists, by port — the store fields `saveModel` reads to build the payload.
 *
 * One list serving two roles that must agree: what the node reads through `ctx.read`, and the `affect`
 * inputs it declares. Splitting them is how a port ends up read but not declared. `resolution` is absent
 * on purpose (the payload hard-codes 60; the backend ignores the port).
 */
const PERSISTED_CONFIG: Module["affect"] = {
  // The `config` object `saveModel` builds.
  buildings: ["saveResult"],
  buildingParams: ["saveResult"],
  technologies: ["saveResult"],
  lines: ["saveResult"],
  mvLines: ["saveResult"],
  transformers: ["saveResult"],
  grids: ["saveResult"],
  weatherSelection: ["saveResult"],
  cookingCarrier: ["saveResult"],
  mode: ["saveResult"],
  electricityPrices: ["saveResult"],
  advancedParams: ["saveResult"],
  // The payload's own fields, which change what a re-save would send just as surely.
  modelName: ["saveResult"],
  fromDate: ["saveResult"],
  toDate: ["saveResult"],
  coordinates: ["saveResult"],
  workspaceId: ["saveResult"],
};

/**
 * Where every persisted-configuration edge lands: `saveResult`, and never `modelId` — an identity survives a
 * configuration change; the save that wrote the configuration does not.
 */
export function createSaveNode(options: SaveNodeOptions): Module {
  const nodeId = options.id ?? "model-save";

  return defineModule({
    id: nodeId,
    name: "Model save",
    // The whole persisted surface, declared. `coordinates` is required: the backend resolves the country
    // from it and refuses a model without one, so the gates keep this node out of play until an area exists.
    params: [
      { port: "modelName" },
      { port: "fromDate" },
      { port: "toDate" },
      { port: "resolution" },
      { port: "workspaceId" },
      { port: "coordinates", required: true },
      { port: "buildings" },
      { port: "buildingParams" },
      { port: "technologies" },
      { port: "lines" },
      { port: "mvLines" },
      { port: "transformers" },
      { port: "grids" },
      { port: "weatherSelection" },
      { port: "cookingCarrier" },
      { port: "mode" },
      { port: "electricityPrices" },
      { port: "advancedParams" },
      { port: "draftId" },
      { port: "userId" },
      { port: "modelId" },
      { port: "saveResult" },
    ],
    // The configuration this node persists is a real dependency of its outputs: see `PERSISTED_CONFIG`.
    affect: PERSISTED_CONFIG,
    // The sidebar carries the verdict, payload and save action; the status strip carries one line.
    layout: ["sidebar", "bottom"],
    // `per-commit`: the record of the save must be sealed before the session is persisted.
    seal: "per-commit",

    run: async (ctx) => {
      const session = options.session();
      if (session === null) throw new NoSessionBound();

      const { store, gateway, flow, registry } = session;
      const modelId = store.data.modelId;

      // Read the configuration through the context, so the dependency is stated over the list `affect` declares.
      for (const port of Object.keys(PERSISTED_CONFIG) as PortKey[]) ctx.read(port);

      const outcome = await saveModel(gateway, {
        store,
        workflow: session.workflow,
        flow,
        registry,
        modelId,
        draftId: store.data.draftId,
        // Live first, stored second — the host knows the current workspace, the store what the session started with.
        workspaceId: session.workspaceId ?? store.data.workspaceId,
        userId: session.userId ?? store.data.userId,
        status: statusFor(flow, registry, store, nodeId, modelId),
        /** The node's own record of the save, committed between Call A and the artefact. */
        onCreated: (createdId, created) => {
          // Read-then-write: both ports already exist on a re-save, and anti-clobber refuses a blind overwrite.
          ctx.read("modelId");
          ctx.read("saveResult");
          ctx.commit(recordSave(createdId, created));
        },
      });

      if (!outcome.ok) throw new SaveRefused(outcome.reason);
      // Nothing left to commit: the record was written before the session was persisted.
    },

    validate: (ctx) => missingPorts(ctx.store),
  });
}

/**
 * The status this save earns — "every node before this one is done", not `position().complete`: while this
 * node runs it *is* the first unfinished node, and nodes placed after the save are `pending` by definition.
 */
function statusFor(
  flow: Flow,
  registry: ModuleRegistry,
  store: Store,
  nodeId: string,
  modelId: number | undefined,
): SaveStatus {
  const states = nodeStates(flow, registry, store);
  const mine = flow.findIndex((node) => node.id === nodeId);
  if (mine === -1) return "incomplete";

  const upstreamDone = flow.slice(0, mine).every((node) => states[node.id] === "done");
  if (!upstreamDone) return "incomplete";
  return modelId === undefined ? "draft" : "modified";
}
