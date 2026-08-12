/**
 * BackendAdapter — the dependency-inversion boundary (Plan P2, README_V2 §7.1).
 *
 * All I/O leaves the feature through this interface:
 *   - http.ts  → real backend (routes in enerplanet/backend/cmd/main.go)
 *   - local.ts → isolation mode (download/upload .enerplanet.json, localStorage)
 *   - mock.ts  → tests
 *
 * Methods for backend features that don't exist yet (timeseries, workflows)
 * are part of the interface but stubbed — see BACKEND_REQUIREMENTS.md.
 */
import type { ModelContext, UserTimeseriesRef } from "../context/types";
import type { WorkflowDefinition } from "../engine/types";

/** Error thrown by adapters for capabilities the backend doesn't have yet. */
export class NotSupportedError extends Error {
  constructor(feature: string) {
    super(`Not supported by this adapter: ${feature}`);
    this.name = "NotSupportedError";
  }
}

// ── Payload shapes (adapter-owned, no imports from other features) ──────────

export interface ModelSummary {
  id: number;
  title: string;
  status: string;
  updatedAt?: string;
  parentId?: number;
}

export interface GenerateGridInput {
  polygons: GeoJSON.FeatureCollection;
  fromDate?: string;
  toDate?: string;
}

export interface GenerateGridResult {
  buildings: ModelContext["grid"]["buildings"];
  lines: GeoJSON.Feature[];
  mvLines: GeoJSON.Feature[];
  transformers: GeoJSON.Feature[];
  grids?: unknown;
  draftId?: string;
}

export interface DemandEstimateInput {
  buildingId: string;
  properties: Record<string, unknown>;
}

export interface DemandEstimate {
  buildingId: string;
  fClass: string;
  yearlyKwh: number;
  peakKw?: number;
}

export interface Technology {
  id: string;
  name: string;
  type?: string;
  params?: Record<string, unknown>;
  constraints?: Record<string, unknown>;
}

export interface GridStats {
  [key: string]: unknown;
}

export interface BackendAdapter {
  // ── models ──────────────────────────────────────────────────────────
  listModels(): Promise<ModelSummary[]>;
  getModelContext(id: number): Promise<ModelContext>;
  /** Creates the model, returns its backend id. */
  saveModel(ctx: ModelContext): Promise<number>;
  updateModel(ctx: ModelContext): Promise<void>;

  // ── pylovo / grid ───────────────────────────────────────────────────
  generateGrid(input: GenerateGridInput): Promise<GenerateGridResult>;
  getBoundary(regionId?: string): Promise<GeoJSON.Feature>;
  gridStatistics(ctx: ModelContext): Promise<GridStats>;
  estimateDemandBatch(inputs: DemandEstimateInput[]): Promise<DemandEstimate[]>;

  // ── technologies ────────────────────────────────────────────────────
  listTechnologies(): Promise<Technology[]>;

  // ── run / results ───────────────────────────────────────────────────
  startCalculation(modelId: number): Promise<void>;
  getResults(modelId: number): Promise<ModelContext["results"]>;

  // ── timeseries (Aspect 4 — backend missing, stubbed) ────────────────
  listTimeseries(): Promise<UserTimeseriesRef[]>;
  deleteTimeseries(id: string): Promise<void>;

  // ── workflows (Aspect 3 — backend missing, stubbed) ─────────────────
  listWorkflows(status?: "draft" | "published"): Promise<WorkflowDefinition[]>;
  saveWorkflow(def: WorkflowDefinition): Promise<void>;
}
