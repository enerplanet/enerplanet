import type { PylovoGridData } from "./area-select";

/**
 * The exact shape of a model payload produced by the configurator's save
 * pipeline (`saveAreaData` in `services/saveService.ts`).
 *
 * This type can be used to validate that a model object is well-formed before
 * it is sent to the backend via `modelService.createModel` / `updateModel`.
 */

/**
 * GeoJSON `MultiPolygon` wrapper produced by `saveAreaData`.
 *
 * `polygonCoordinates` is `[number, number][][]` (an array of polygons, each a
 * ring of `[lon, lat]` pairs). Each polygon is wrapped in an extra array to
 * form a MultiPolygon: `coordinates: polygonCoordinates.map(p => [p])`.
 */
export interface ModelCoordinates {
  type: "MultiPolygon";
  coordinates: number[][][][];
}

/**
 * The `pypsa` block added by `buildSaveConfig` when PyPSA is enabled.
 */
export interface ModelPypsaConfig {
  trafo_mv_lv_used: true;
  trafo_mv_lv_type: string;
  line_type_mv: string;
  line_type_lv: string;
}

/**
 * The `config` object built by `buildSaveConfig`.
 *
 * It copies the grid layers from `PylovoGridData` (buildings, lines,
 * mv_lines, transformers, grids) and adds a `pypsa` block — or `pypsa: false`
 * when PyPSA is disabled. The config is `undefined` when empty.
 */
export interface ModelConfig {
  buildings?: PylovoGridData["buildings"];
  lines?: PylovoGridData["lines"];
  mv_lines?: PylovoGridData["mv_lines"];
  transformers?: PylovoGridData["transformers"];
  grids?: PylovoGridData["grids"];
  pypsa?: ModelPypsaConfig | false;
}

/**
 * The model payload assembled by `saveAreaData` and sent to the backend.
 *
 * This is the **create** payload. In **edit mode** the same shape is sent via
 * `updateModel`, optionally with `status: "modified"` when changes are
 * detected (see {@link UpdateModelPayload}).
 */
export interface ModelPayload {
  title: string;
  from_date: string;
  to_date: string;
  resolution: number;
  workspace_id?: number;
  coordinates: ModelCoordinates;
  config?: ModelConfig;
}

/**
 * The payload sent in **edit mode**.
 *
 * Identical to {@link ModelPayload} but every field is optional (matching
 * `UpdateModelRequest`), and `status` may be set to `"modified"` when the
 * config fingerprint differs from the original model.
 */
export interface UpdateModelPayload {
  title?: string;
  from_date?: string;
  to_date?: string;
  resolution?: number;
  workspace_id?: number;
  coordinates?: ModelCoordinates;
  config?: ModelConfig;
  status?: "modified";
}

/**
 * A fully-formed model as it would be created by the save function.
 *
 * This is the strict, validated shape. Use it to type-check a model object
 * before it is handed to `modelService.createModel` / `updateModel`.
 */
export type SaveableModel = ModelPayload;

/**
 * Runtime validation guard for {@link ModelPayload}.
 *
 * Returns `true` when the object is a well-formed model payload matching what
 * `saveAreaData` produces. Useful for validating data before sending it off.
 */
export function isModelPayload(value: unknown): value is ModelPayload {
  if (typeof value !== "object" || value === null) return false;

  const v = value as Record<string, unknown>;

  if (typeof v.title !== "string" || v.title.trim().length === 0) return false;
  if (typeof v.from_date !== "string" || v.from_date.length === 0) return false;
  if (typeof v.to_date !== "string" || v.to_date.length === 0) return false;
  if (typeof v.resolution !== "number" || !Number.isFinite(v.resolution)) return false;

  if (v.workspace_id !== undefined && typeof v.workspace_id !== "number") return false;

  if (!isModelCoordinates(v.coordinates)) return false;

  if (v.config !== undefined && !isModelConfig(v.config)) return false;

  return true;
}

function isModelCoordinates(value: unknown): value is ModelCoordinates {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.type !== "MultiPolygon") return false;
  if (!Array.isArray(v.coordinates)) return false;
  // Each polygon is an array of rings; each ring is an array of [lon, lat].
  return v.coordinates.every(
    (polygon) =>
      Array.isArray(polygon) &&
      polygon.every(
        (ring) =>
          Array.isArray(ring) &&
          ring.every(
            (point) =>
              Array.isArray(point) &&
              point.length >= 2 &&
              point.every((n) => typeof n === "number" && Number.isFinite(n)),
          ),
      ),
  );
}

function isModelConfig(value: unknown): value is ModelConfig {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;

  if (v.pypsa !== undefined) {
    if (v.pypsa === false) {
      // allowed
    } else if (typeof v.pypsa === "object" && v.pypsa !== null) {
      const p = v.pypsa as Record<string, unknown>;
      if (p.trafo_mv_lv_used !== true) return false;
      if (typeof p.trafo_mv_lv_type !== "string") return false;
      if (typeof p.line_type_mv !== "string") return false;
      if (typeof p.line_type_lv !== "string") return false;
    } else {
      return false;
    }
  }

  return true;
}
