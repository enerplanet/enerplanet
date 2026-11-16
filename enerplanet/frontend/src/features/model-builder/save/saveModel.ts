/**
 * The save node's logic (case T13) — the two-call split, and the legacy payload built from the store.
 *
 * The payload shape is not invented here: `.local/ModularThesis/prototypes/sk-node-workflow/
 * integration/saveService.ts` is a verbatim extraction of the legacy `saveAreaData`
 * (`configurator/hooks/useAreaSelect.ts:370-404`), and `buildSaveConfig` / `buildModelPayload` reproduce it
 * key for key. That extraction is the oracle the tests check against — parity is the whole reason this code
 * exists, so it is pinned rather than approximated.
 *
 * One respect in which the oracle is *not* the original, worth knowing before trusting the comparison blindly:
 * the extraction curates `config` to the ports the store holds, while the legacy spread the whole `pylovoData`
 * object — so `meta` and `boundary` travelled on the real wire and do not here. `modules/model-save.md` carries
 * the full parity audit. One legacy config key is still written absent rather than reproduced: **`site`**,
 * which the legacy sets when the user edits the grid — it clones pylovo's grid into an editable site and
 * records that copy's identity (`{ mode: 'site', site_id, revision }`) so the save points at the copy rather
 * than the original. That is `grid-editor`'s output, and `grid-editor` is deferred, so there is nothing
 * honest to write. The other keys the audit listed (`weather*`, `cookingCarrier`, `mode`,
 * `electricity_prices`) now have ports and are written verbatim.
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
import { foldBuildings } from "./fold";
import type { LegacyModelPayload, ModelGateway, SaveStatus } from "./gateway";

/** The legacy pypsa defaults, copied from the extracted legacy save. */
const PYPSA_DEFAULTS = {
  trafo_mv_lv_type: "0.4 MVA 20/0.4 kV",
  line_type_mv: "NA2XS2Y 1x185 RM/25 12/20 kV",
  line_type_lv: "NAYY 4x150 SE",
} as const;

/**
 * The legacy's three settings keys, each written verbatim from its port — including the odd spelling (`mode`
 * lowercase, `electricity_prices` snake_case beside `cookingCarrier` camelCase), because parity is the point.
 *
 * An absent port writes nothing rather than a default: the defaults belong to `model-start`, which seeds them
 * on every model. A save that invented its own would let a model look decided when nobody decided anything.
 */
function settingsKeys(data: Readonly<ModelData>): Record<string, unknown> {
  return {
    ...(data.cookingCarrier === undefined ? {} : { cookingCarrier: data.cookingCarrier }),
    ...(data.mode === undefined ? {} : { mode: data.mode }),
    ...(data.electricityPrices === undefined ? {} : { electricity_prices: data.electricityPrices }),
  };
}

/**
 * The `config` object for a complete flow — the legacy `buildSaveConfig`, reading ports instead of
 * `pylovoData`. Note `mvLines` → `mv_lines`: the store keeps camelCase, the wire keeps the legacy
 * snake_case, and the mapping is exactly the kind of thing parity tests exist to hold still.
 */
export function buildSaveConfig(data: Readonly<ModelData>): Record<string, unknown> {
  const config: Record<string, unknown> = {};

  // The buildings go out **folded**: the store keeps demand and technologies as ports, the legacy keeps them on
  // the features, and `config.buildings` is that same feature collection (`save/fold.ts`).
  const buildings = foldBuildings(data.buildings, data.buildingParams, data.technologies);
  if (buildings !== undefined) config.buildings = buildings;

  if (data.lines) config.lines = data.lines;
  if (data.mvLines) config.mv_lines = data.mvLines;
  if (data.transformers) config.transformers = data.transformers;
  if (data.grids) config.grids = data.grids;

  // The weather, in the legacy's three keys — this is `applyWeatherToConfig`, which the legacy calls with the
  // period's year. A recorded year wins over a scenario, and the archive is omitted when it is the default.
  const weather = data.weatherSelection;
  if (weather !== undefined && weather.provider !== null) config.weatherProvider = weather.provider;
  if (weather?.choice === "year" && weather.year !== undefined) config.weatherYear = weather.year;
  if (weather !== undefined && weather.choice !== "year") config.weatherScenario = weather.choice;

  // The legacy's three settings keys, each written verbatim from its port. See `settingsKeys`.
  Object.assign(config, settingsKeys(data));

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
    // Hard-coded to 60, because that is what the legacy does — its own comment says "only 60-minute steps are
    // supported", so the store's `resolution` is a port the backend currently ignores. Reading it here would
    // send a value the backend cannot honour and call it parity.
    resolution: 60,
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
  /**
   * Pin the status instead of deriving it from completeness. The workflow bar's save pins `incomplete` (§6):
   * an unfinished model still round-trips with its session, and *finishing* one — the real `model.json`,
   * promoted to `draft` so that a run accepts it — belongs to the save node behind its completeness gate.
   * Absent, the status is derived below, which is what that node's own path relies on.
   */
  status?: SaveStatus;
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
  // Pinned by the caller when the caller is the workflow bar; otherwise derived from completeness, which is
  // the difference §6 draws between the bar's save and the save node's.
  const status: SaveStatus =
    request.status ?? (complete ? (request.modelId === undefined ? "draft" : "modified") : "incomplete");

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
