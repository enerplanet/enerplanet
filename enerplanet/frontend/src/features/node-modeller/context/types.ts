/**
 * Node Modeller — context core types (Plan P1, README_V2 Aspect 1).
 *
 * The context is the only state: single, serializable, versioned object.
 * Every change goes through `apply(action)` producing a reversible diff.
 */

// ── Slice keys ──────────────────────────────────────────────────────────────

export type SliceKey =
  | "meta"
  | "region"
  | "grid"
  | "demand"
  | "techAssignments"
  | "pypsa"
  | "results"
  | "userData";

// ── Slices ──────────────────────────────────────────────────────────────────

export interface ModelMeta {
  title: string;
  description?: string;
  fromDate?: string; // ISO date
  toDate?: string; // ISO date
  resolution?: string; // e.g. "1h"
  workspaceId?: string;
  optimizationGoal?: "self-reliance" | "renewables-co2" | "cheapest";
}

export interface RegionSlice {
  /** GeoJSON FeatureCollection of user-drawn polygons (model.coordinates). */
  polygons?: GeoJSON.FeatureCollection;
  /** Region boundary as returned by GET /v2/pylovo/boundary. */
  boundary?: GeoJSON.Feature;
}

export interface Building {
  osmId: string;
  geometry: GeoJSON.Geometry;
  properties: Record<string, unknown>;
}

export interface GridSlice {
  buildings: Building[];
  lines: GeoJSON.Feature[];
  mvLines: GeoJSON.Feature[];
  transformers: GeoJSON.Feature[];
  /** Raw pylovo grids payload, kept verbatim for save/compile. */
  grids?: unknown;
  /** draft_id for the user-placed transformer handshake. */
  draftId?: string;
}

export interface DemandEntry {
  buildingId: string;
  fClass: string;
  yearlyKwh: number;
  peakKw?: number;
}

export interface DemandSlice {
  entries: Record<string, DemandEntry>; // keyed by buildingId
}

export interface TechParams {
  [key: string]: string | number | boolean;
}

export interface TechAssignment {
  techId: string;
  params?: TechParams;
}

export interface TechSlice {
  /** buildingId → assigned technologies. */
  assignments: Record<string, TechAssignment[]>;
}

export interface PypsaSlice {
  [key: string]: unknown; // advanced simulation parameters, free-form
}

export interface ResultsSlice {
  /** Raw results payloads keyed by endpoint name. */
  data: Record<string, unknown>;
  runId?: number;
  finishedAt?: string;
  /** Previous run results kept for comparison (Aspect 5 run compare). */
  previous?: Omit<ResultsSlice, "previous">;
}

export interface UserTimeseriesRef {
  id: string;
  name: string;
  kind: "demand" | "production";
  unit: "kWh" | "kW" | "MW";
  resolution: "hourly" | "quarter-hourly";
  scope: "all-buildings" | "building" | "region";
  buildingId?: string;
  validFrom?: string;
  validTo?: string;
}

export interface UserDataSlice {
  timeseries: UserTimeseriesRef[];
  /** Custom location ids referenced by this model. */
  locationIds: string[];
}

// ── History ─────────────────────────────────────────────────────────────────

export type ContextDiff =
  | { op: "replace"; path: string; prev: unknown; next: unknown }
  | { op: "remove"; path: string; prev: unknown };

export interface HistoryEntry {
  revision: number;
  timestamp: string; // ISO
  nodeId?: string;
  actionType: string;
  diff: ContextDiff[];
  runSnapshot?: { runId: number; startedAt: string };
}

// ── Context ─────────────────────────────────────────────────────────────────

export type ModelStatus = "draft" | "modified" | "running" | "completed" | "failed";

export interface ModelContext {
  schemaVersion: 1;
  revision: number;
  id?: number;
  parentId?: number;
  status: ModelStatus;

  meta: ModelMeta;
  region: RegionSlice;
  grid: GridSlice;
  demand: DemandSlice;
  techAssignments: TechSlice;
  pypsa: PypsaSlice;
  results?: ResultsSlice;
  userData: UserDataSlice;

  history: HistoryEntry[];
  undoStack: ContextDiff[][];
  redoStack: ContextDiff[][];
}

// ── Actions ─────────────────────────────────────────────────────────────────

export interface BuildingPatch {
  properties?: Record<string, unknown>;
  geometry?: GeoJSON.Geometry;
}

export type ContextAction =
  | { type: "set-meta"; payload: Partial<ModelMeta> }
  | { type: "set-region"; payload: Partial<RegionSlice> }
  | { type: "set-grid"; payload: Partial<GridSlice> }
  | { type: "update-building"; payload: { osmId: string; patch: BuildingPatch } }
  | { type: "assign-tech"; payload: { osmIds: string[]; techId: string; params?: TechParams; nodeId?: string } }
  | { type: "remove-tech"; payload: { osmIds: string[]; techId: string } }
  | { type: "set-demand"; payload: DemandEntry }
  | { type: "set-pypsa"; payload: Partial<PypsaSlice> }
  | { type: "set-results"; payload: ResultsSlice }
  | { type: "set-status"; payload: ModelStatus }
  | { type: "set-id"; payload: { id?: number; parentId?: number } }
  | { type: "add-timeseries"; payload: UserTimeseriesRef }
  | { type: "remove-timeseries"; payload: { id: string } }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "load-snapshot"; payload: ModelContext };

// ── Result of apply() ───────────────────────────────────────────────────────

export interface ApplyResult {
  next: ModelContext;
  diff: ContextDiff[]; // empty for undo/redo/load-snapshot (already recorded)
}
