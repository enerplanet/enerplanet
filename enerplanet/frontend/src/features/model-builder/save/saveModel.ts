/**
 * The save node's logic (case T13) — the two-call split, and the legacy payload built from the store.
 *
 * The payload shape is not invented here: `.local/ModularThesis/prototypes/sk-node-workflow/
 * integration/saveService.ts` is a verbatim extraction of the legacy `saveAreaData`, and
 * `buildSaveConfig` / `buildModelPayload` reproduce it key for key. That extraction is the oracle the
 * tests check against — parity is the whole reason this code exists, so it is pinned rather than
 * approximated.
 *
 * Two deliberate differences from the legacy original:
 *
 * 1. **The config is never absent.** The legacy sent `undefined` when it had no grid data; here an
 *    unfinished model sends `{}` (a valid, empty `model.json`) and a finished one sends the built
 *    config or `{}`. Call A requires a config, and a half-built model should look unfinished to a
 *    legacy consumer rather than like a model with only defaults in it. Nothing is lost by that: the
 *    real state travels in Call B's artefact.
 * 2. **The status comes from the flow.** `incomplete` while the flow has unfinished nodes, `draft` on
 *    a first complete save, `modified` when an existing model is saved again. The legacy's finer rule
 *    ("only mark modified if the config fingerprint moved") needs an original-config handle the store
 *    does not carry yet — it belongs to `model-load`, not here.
 *
 * Call A's failure propagates: nothing was saved. Call B's failure does not — the model *is* saved,
 * so the outcome says exactly what is missing instead of throwing away the model id.
 */

import { toArtefact, type WorkflowRef } from "../core/artefact";
import type { Flow, ModuleRegistry } from "../core/flow";
import { position } from "../core/position";
import type { ModelData } from "../core/ports";
import type { Store } from "../core/store";
import type { LegacyModelPayload, ModelGateway, SaveStatus } from "./gateway";

/** The legacy pypsa defaults, copied from the extracted legacy save. */
const PYPSA_DEFAULTS = {
  trafo_mv_lv_type: "0.4 MVA 20/0.4 kV",
  line_type_mv: "NA2XS2Y 1x185 RM/25 12/20 kV",
  line_type_lv: "NAYY 4x150 SE",
} as const;

/**
 * The `config` object for a complete flow — the legacy `buildSaveConfig`, reading ports instead of
 * `pylovoData`. Note `mvLines` → `mv_lines`: the store keeps camelCase, the wire keeps the legacy
 * snake_case, and the mapping is exactly the kind of thing parity tests exist to hold still.
 */
export function buildSaveConfig(data: Readonly<ModelData>): Record<string, unknown> {
  const config: Record<string, unknown> = {};
  if (data.buildings) config.buildings = data.buildings;
  if (data.lines) config.lines = data.lines;
  if (data.mvLines) config.mv_lines = data.mvLines;
  if (data.transformers) config.transformers = data.transformers;
  if (data.grids) config.grids = data.grids;

  // PyPSA is on unless a settings module turned it off (`pypsa_enabled === false`).
  const advanced = data.advancedParams;
  if (advanced?.pypsa_enabled !== false) {
    config.pypsa = {
      trafo_mv_lv_used: true,
      trafo_mv_lv_type: (advanced?.trafo_mv_lv_type as string | undefined) || PYPSA_DEFAULTS.trafo_mv_lv_type,
      line_type_mv: (advanced?.line_type_mv as string | undefined) || PYPSA_DEFAULTS.line_type_mv,
      line_type_lv: (advanced?.line_type_lv as string | undefined) || PYPSA_DEFAULTS.line_type_lv,
    };
  } else {
    config.pypsa = false;
  }

  return config;
}

export interface PayloadOptions {
  workspaceId?: number;
  status: SaveStatus;
}

/** The wire payload for Call A. */
export function buildModelPayload(
  data: Readonly<ModelData>,
  options: PayloadOptions,
): LegacyModelPayload {
  // The legacy wraps each drawn ring into a polygon: `polygonCoordinates.map(p => [p])`.
  const coordinates: GeoJSON.MultiPolygon = {
    type: "MultiPolygon",
    coordinates: (data.coordinates ?? []).map((ring) => [ring]),
  };

  // An unfinished flow sends an empty config on purpose: there is no model yet, and the session
  // (Call B) is what carries the state that does exist.
  const config = options.status === "incomplete" ? {} : buildSaveConfig(data);

  return {
    title: (data.modelName ?? "").trim(),
    from_date: data.fromDate ?? "",
    to_date: data.toDate ?? "",
    resolution: data.resolution ?? 60,
    ...(options.workspaceId === undefined ? {} : { workspace_id: options.workspaceId }),
    coordinates,
    config,
    status: options.status,
  };
}

/** Why the save was refused before anything was sent — the legacy `isValidSaveData`, named. */
export type SaveRefusal = "missing-name" | "missing-dates" | "missing-coordinates";

export type SaveOutcome =
  | { ok: false; reason: SaveRefusal }
  | {
      ok: true;
      modelId: number;
      created: boolean;
      status: SaveStatus;
      /** False only when Call A succeeded and Call B did not — a partial save, stated plainly. */
      historySaved: boolean;
      historyError?: string;
    };

export interface SaveRequest {
  store: Store;
  /** The session's workflow reference — what the artefact points at instead of copying. */
  workflow: WorkflowRef;
  /** The flow, for the completeness decision: every node done ⇒ the model is runnable. */
  flow: Flow;
  registry: ModuleRegistry;
  /** Set once the session belongs to a saved model; absent means this is the first save. */
  modelId?: number;
  workspaceId?: number;
  draftId?: string;
  userId?: string;
}

/**
 * Save the session: Call A (the legacy payload), then Call B (the artefact).
 *
 * @throws whatever the gateway throws from Call A — nothing was saved, so the caller reports a failed
 *         save. Call B's failure is returned instead (see `SaveOutcome.historySaved`).
 */
export async function saveModel(
  gateway: ModelGateway,
  request: SaveRequest,
): Promise<SaveOutcome> {
  const { store, flow, registry } = request;
  const data = store.data;

  const refusal = refusalFor(data);
  if (refusal !== undefined) return { ok: false, reason: refusal };

  const complete = position(flow, registry, store).complete;
  const status: SaveStatus = complete ? (request.modelId === undefined ? "draft" : "modified") : "incomplete";

  const payload = buildModelPayload(data, {
    workspaceId: request.workspaceId ?? data.workspaceId,
    status,
  });

  // Call A first, always: B's row is keyed on a model that may not exist until A creates it.
  let modelId = request.modelId;
  let created = false;
  if (modelId === undefined) {
    const response = await gateway.createModel(payload, {
      draftId: request.draftId,
      userId: request.userId,
    });
    modelId = response.modelId;
    created = true;
  } else {
    await gateway.updateModel(modelId, payload);
  }

  const artefact = toArtefact({ store, workflow: request.workflow, modelId });
  try {
    await gateway.saveSession(modelId, artefact, request.workflow);
  } catch (error) {
    return {
      ok: true,
      modelId,
      created,
      status,
      historySaved: false,
      historyError: error instanceof Error ? error.message : String(error),
    };
  }

  return { ok: true, modelId, created, status, historySaved: true };
}

function refusalFor(data: Readonly<ModelData>): SaveRefusal | undefined {
  if ((data.modelName ?? "").trim().length === 0) return "missing-name";
  if (!data.fromDate || !data.toDate) return "missing-dates";
  if ((data.coordinates ?? []).length === 0) return "missing-coordinates";
  return undefined;
}
