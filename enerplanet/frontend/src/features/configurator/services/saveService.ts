import { modelService } from "../../model-dashboard/services/modelService";
import { pylovoService } from "./pylovoService";
import type { PylovoGridData } from "../types/area-select";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Parameters accepted by `saveAreaData`.
 *
 * Mirrors the legacy `saveAreaData` parameter bag but uses direct service
 * calls instead of React Query mutations, and omits navigation (the workflow
 * engine handles that).
 */
export interface SaveAreaDataParams {
  fromDate: string;
  toDate: string;
  modelName: string;
  resolution?: number;
  editMode?: boolean;
  modelId?: number;
  polygonCoordinates: [number, number][][];
  workspaceId?: number;
  pylovoData?: PylovoGridData;
  /** Mapped from `simulationSettings` to the shape `buildSaveConfig` expects. */
  advancedParams?: Record<string, unknown>;
  draftId?: string;
  userId?: string;
  /** The original model fetched at load time — used for change detection in edit mode. */
  originalModel?: { title?: string; from_date?: string; to_date?: string; resolution?: number; config?: Record<string, unknown> } | null;
  /** Called before the save starts (e.g. to set a saving flag). */
  onSaveStart?: () => void;
  /** Called after the save completes (success or failure). */
  onSaveEnd?: () => void;
}

export interface SaveAreaDataResult {
  modelId: number;
  created: boolean;
}

// ---------------------------------------------------------------------------
// Helpers (extracted verbatim from the legacy configurator)
// ---------------------------------------------------------------------------

/**
 * Build the `config` object for the model payload.
 *
 * Copies `buildings`, `lines`, `mv_lines`, `transformers`, `grids` from
 * `pylovoData` and adds a `pypsa` block (unless `pypsa_enabled === false`).
 *
 * Uses `any` internally to match the original loose typing in
 * `useAreaSelect.ts`. The payload shape is backend-defined and not
 * representable as a strict TypeScript type without a schema.
 */
export function buildSaveConfig(
  pylovoData: PylovoGridData | undefined,
  advancedParams: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!pylovoData) return undefined;

  const config: Record<string, unknown> = {};
  if (pylovoData.buildings) config.buildings = pylovoData.buildings;
  if (pylovoData.lines) config.lines = pylovoData.lines;
  if (pylovoData.mv_lines) config.mv_lines = pylovoData.mv_lines;
  if (pylovoData.transformers) config.transformers = pylovoData.transformers;
  if (pylovoData.grids) config.grids = pylovoData.grids;

  // Check if PyPSA is enabled (default: true)
  const pypsaEnabled = advancedParams?.pypsa_enabled !== false;

  if (pypsaEnabled) {
    config.pypsa = {
      trafo_mv_lv_used: true,
      trafo_mv_lv_type:
        (advancedParams?.trafo_mv_lv_type as string | undefined) ||
        "0.4 MVA 20/0.4 kV",
      line_type_mv:
        (advancedParams?.line_type_mv as string | undefined) ||
        "NA2XS2Y 1x185 RM/25 12/20 kV",
      line_type_lv:
        (advancedParams?.line_type_lv as string | undefined) ||
        "NAYY 4x150 SE",
    };
  } else {
    config.pypsa = false;
  }

  return Object.keys(config).length > 0 ? config : undefined;
}

/**
 * Fingerprint a config by counting features and tech assignments.
 *
 * Robust to floating-point / key-ordering differences that break
 * `JSON.stringify` equality. Uses `any` internally to match the original
 * loose typing in `useAreaSelect.ts`.
 */
export function configFingerprint(
  cfg: Record<string, unknown> | undefined,
): string {
  if (!cfg) return "";
  const cfgAny = cfg as any;
  const fc = (g: any) => g?.features?.length ?? 0;
  const techCount = (cfgAny.buildings?.features || []).reduce(
    (s: number, f: any) => s + (f.properties?.technologies?.length || 0),
    0,
  );
  // Sort pypsa keys so DB key-order vs code key-order doesn't cause a mismatch
  const pypsaStr =
    cfgAny.pypsa && typeof cfgAny.pypsa === "object"
      ? JSON.stringify(cfgAny.pypsa, Object.keys(cfgAny.pypsa).sort())
      : JSON.stringify(cfgAny.pypsa ?? null);
  return [
    fc(cfgAny.buildings),
    fc(cfgAny.transformers),
    fc(cfgAny.lines),
    fc(cfgAny.mv_lines),
    fc(cfgAny.grids),
    techCount,
    pypsaStr,
  ].join("|");
}

/**
 * Validate that all required save fields are present.
 */
export function isValidSaveData(
  fromDate: string,
  toDate: string,
  modelName: string,
  polygonCoordinates: unknown,
): boolean {
  return Boolean(
    fromDate && toDate && modelName?.trim() && (polygonCoordinates as any[])?.length > 0,
  );
}

/**
 * Map modular `simulationSettings` to the shape `buildSaveConfig` expects.
 *
 * The legacy `AdvancedParametersState` includes `trafo_mv_lv_type`,
 * `line_type_mv`, `line_type_lv`, and `pypsa_enabled`. The modular
 * `SimulationSettings` carries the same cable/transformer fields plus
 * scenario-derived dates.
 */
export function mapSimulationSettingsToAdvancedParams(settings: {
  line_type_lv?: string;
  line_type_mv?: string;
  pypsa_enabled?: boolean;
  co2_limit?: number;
  max_hours?: number;
  autarky?: number;
  scenario?: { type: string; value: string };
}): Record<string, unknown> {
  return {
    line_type_lv: settings.line_type_lv ?? "NAYY 4x150 SE",
    line_type_mv: settings.line_type_mv ?? "NA2XS2Y 1x185 RM/25 12/20 kV",
    trafo_mv_lv_type: "0.4 MVA 20/0.4 kV",
    pypsa_enabled: settings.pypsa_enabled ?? true,
    co2_limit: settings.co2_limit ?? 20000000,
    max_hours: settings.max_hours ?? 72,
    autarky: settings.autarky ?? 0,
    scenario: settings.scenario
      ? `${settings.scenario.type}/${settings.scenario.value}`
      : "season/winter",
  };
}

// ---------------------------------------------------------------------------
// Core save pipeline
// ---------------------------------------------------------------------------

/**
 * Full save pipeline, matching the legacy `saveAreaData` logic.
 *
 * 1. Validates inputs via `isValidSaveData`.
 * 2. Builds `coordinatesGeoJSON` (MultiPolygon).
 * 3. Builds `config` via `buildSaveConfig`.
 * 4. Assembles the model payload.
 * 5. **Edit path**: calls `modelService.updateModel` with `status: 'modified'`
 *    when the config fingerprint differs from the original.
 * 6. **Create path**: calls `modelService.createModel`, then
 *    `pylovoService.finalizeTransformers` if a `draftId` exists.
 *
 * @returns The saved model ID and whether it was created (vs updated).
 */
export async function saveAreaData(
  params: SaveAreaDataParams,
): Promise<SaveAreaDataResult | null> {
  const {
    fromDate,
    toDate,
    modelName,
    resolution,
    editMode,
    modelId,
    polygonCoordinates,
    workspaceId,
    pylovoData,
    advancedParams,
    draftId,
    userId,
    originalModel,
    onSaveStart,
    onSaveEnd,
  } = params;

  if (!isValidSaveData(fromDate, toDate, modelName, polygonCoordinates)) {
    return null;
  }

  onSaveStart?.();
  try {
    const coordinatesGeoJSON = {
      type: "MultiPolygon",
      coordinates: polygonCoordinates.map((polygon) => [polygon]),
    };

    const config = buildSaveConfig(pylovoData, advancedParams);

    const modelPayload: Record<string, unknown> = {
      title: modelName.trim(),
      from_date: fromDate,
      to_date: toDate,
      resolution: resolution ?? 60,
      workspace_id: workspaceId,
      coordinates: coordinatesGeoJSON,
      config,
    };

    if (editMode && modelId) {
      // Detect whether the user actually changed anything
      let hasChanges = !originalModel;
      if (originalModel) {
        hasChanges =
          originalModel.title !== modelPayload.title ||
          originalModel.from_date !== modelPayload.from_date ||
          originalModel.to_date !== modelPayload.to_date ||
          originalModel.resolution !== modelPayload.resolution ||
          configFingerprint(
            originalModel.config as Record<string, unknown> | undefined,
          ) !== configFingerprint(config);
      }

      const updatePayload = hasChanges
        ? { ...modelPayload, status: "modified" as const }
        : modelPayload;

      await modelService.updateModel(modelId, updatePayload);
      return { modelId, created: false };
    } else {
      // Create new model
      const newModel = await modelService.createModel(
        modelPayload as unknown as Parameters<typeof modelService.createModel>[0],
      );
      const newModelId = newModel.data?.id;

      if (!newModelId) {
        throw new Error("Model created but no ID returned");
      }

      // Finalize user-placed transformers: convert draft_id to model_id
      if (draftId && userId) {
        try {
          await pylovoService.finalizeTransformers(draftId, newModelId, userId);
        } catch (err) {
          // Log but don't fail the save — transformers are nice-to-have
          console.error("Failed to finalize transformers:", err);
        }
      }

      return { modelId: newModelId, created: true };
    }
  } finally {
    onSaveEnd?.();
  }
}

/**
 * Simplified `getUpdatedPylovoData` for the modular workflow.
 *
 * The legacy version re-serialises live OpenLayers features to capture
 * in-map edits (building demand, tech assignments, etc.). In the modular
 * workflow, those edits are expected to be applied to `gridData` before
 * the save module runs (e.g. by the `area-edit` or `technology-selection`
 * modules).
 *
 * If the caller has in-memory building edits that haven't been applied to
 * `gridData.buildings`, pass them via `buildingEdits` — they will be
 * merged into the buildings feature collection.
 *
 * @param gridData - The current `PylovoGridData` from context.
 * @param buildingEdits - Optional GeoJSON FeatureCollection of edited buildings
 *   to merge into `gridData.buildings`.
 * @returns A fresh `PylovoGridData` snapshot with edits applied.
 */
export function getUpdatedPylovoData(
  gridData: PylovoGridData | undefined,
  buildingEdits?: GeoJSON.FeatureCollection,
): PylovoGridData | undefined {
  if (!gridData) return undefined;

  // Deep-clone so we don't mutate the original
  const updated: PylovoGridData = JSON.parse(JSON.stringify(gridData));

  if (buildingEdits?.features?.length && updated.buildings?.features) {
    // Build a lookup of edited features by a stable key (osm_id or index)
    const editMap = new Map<string, GeoJSON.Feature>();
    for (const feat of buildingEdits.features) {
      const key =
        (feat.properties as Record<string, unknown>)?.["osm_id"] ??
        (feat.properties as Record<string, unknown>)?.["id"];
      if (key != null) {
        editMap.set(String(key), feat);
      }
    }

    // Merge edits into the buildings array
    updated.buildings.features = updated.buildings.features.map((existing) => {
      const key =
        (existing.properties as Record<string, unknown>)?.["osm_id"] ??
        (existing.properties as Record<string, unknown>)?.["id"];
      if (key != null && editMap.has(String(key))) {
        return editMap.get(String(key))!;
      }
      return existing;
    });
  }

  return updated;
}
