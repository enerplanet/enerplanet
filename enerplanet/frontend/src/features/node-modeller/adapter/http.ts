/**
 * HTTP adapter — binds the BackendAdapter to the real backend.
 * Routes per enerplanet/backend/cmd/main.go (see BACKEND_REQUIREMENTS.md).
 *
 * Deliberately uses a plain axios instance created by the caller, not the
 * app's shared `@/lib/axios`, to keep the feature isolated (Plan decision 4/5).
 */
import type { AxiosInstance } from "axios";
import type { ModelContext, UserTimeseriesRef } from "../context/types";
import type { WorkflowDefinition } from "../engine/types";
import type {
  BackendAdapter,
  DemandEstimate,
  DemandEstimateInput,
  GenerateGridInput,
  GenerateGridResult,
  GridStats,
  ModelSummary,
  Technology,
} from "./types";
import { NotSupportedError } from "./types";

export interface HttpAdapterOptions {
  /** Pre-configured axios instance (auth headers, baseURL ending at /api). */
  http: AxiosInstance;
  /**
   * Maps a backend model payload (GET /models/:id) into a ModelContext.
   * Injected because the backend model shape is owned by the host app;
   * the node-modeller must not import it.
   */
  hydrateModel: (raw: unknown) => ModelContext;
  /** Maps a context into the backend save payload (POST/PUT /models). */
  serializeModel: (ctx: ModelContext) => unknown;
}

export function createHttpAdapter(opts: HttpAdapterOptions): BackendAdapter {
  const { http, hydrateModel, serializeModel } = opts;

  return {
    async listModels(): Promise<ModelSummary[]> {
      const { data } = await http.get("/models");
      const items = Array.isArray(data) ? data : (data?.models ?? []);
      return items.map((m: Record<string, unknown>) => ({
        id: m.id as number,
        title: (m.title as string) ?? "Untitled",
        status: (m.status as string) ?? "draft",
        updatedAt: m.updated_at as string | undefined,
        parentId: m.parent_model_id as number | undefined,
      }));
    },

    async getModelContext(id: number): Promise<ModelContext> {
      const { data } = await http.get(`/models/${id}`);
      return hydrateModel(data);
    },

    async saveModel(ctx: ModelContext): Promise<number> {
      const { data } = await http.post("/models", serializeModel(ctx));
      return data.id as number;
    },

    async updateModel(ctx: ModelContext): Promise<void> {
      await http.put(`/models/${ctx.id}`, serializeModel(ctx));
    },

    async generateGrid(input: GenerateGridInput): Promise<GenerateGridResult> {
      const { data } = await http.post("/v2/pylovo/generate-grid", input);
      return {
        buildings: data.buildings ?? [],
        lines: data.lines ?? [],
        mvLines: data.mv_lines ?? [],
        transformers: data.transformers ?? [],
        grids: data.grids,
        draftId: data.draft_id,
      };
    },

    async getBoundary(regionId?: string): Promise<GeoJSON.Feature> {
      const { data } = await http.get("/v2/pylovo/boundary", { params: regionId ? { region: regionId } : {} });
      return data;
    },

    async gridStatistics(ctx: ModelContext): Promise<GridStats> {
      const { data } = await http.post("/v2/pylovo/grid-statistics", ctx.grid.grids ?? ctx.grid);
      return data;
    },

    async estimateDemandBatch(inputs: DemandEstimateInput[]): Promise<DemandEstimate[]> {
      const { data } = await http.post("/v2/pylovo/estimate-energy-batch", { buildings: inputs });
      const rows = Array.isArray(data) ? data : (data?.estimates ?? []);
      return rows.map((r: Record<string, unknown>) => ({
        buildingId: (r.building_id ?? r.buildingId) as string,
        fClass: (r.f_class ?? r.fClass ?? "unknown") as string,
        yearlyKwh: (r.yearly_kwh ?? r.yearlyKwh ?? 0) as number,
        peakKw: (r.peak_kw ?? r.peakKw) as number | undefined,
      }));
    },

    async listTechnologies(): Promise<Technology[]> {
      const { data } = await http.get("/technologies");
      return Array.isArray(data) ? data : (data?.technologies ?? []);
    },

    async startCalculation(modelId: number): Promise<void> {
      await http.post(`/calculation/start/${modelId}`);
    },

    async getResults(modelId: number): Promise<ModelContext["results"]> {
      const [pypsa, carrier, system] = await Promise.allSettled([
        http.get(`/models/${modelId}/results/pypsa`),
        http.get(`/models/${modelId}/results/carrier-timeseries`),
        http.get(`/models/${modelId}/results/system-timeseries`),
      ]);
      const unwrap = (r: PromiseSettledResult<{ data: unknown }>) =>
        r.status === "fulfilled" ? r.value.data : undefined;
      return {
        data: {
          pypsa: unwrap(pypsa),
          carrierTimeseries: unwrap(carrier),
          systemTimeseries: unwrap(system),
        },
        finishedAt: new Date().toISOString(),
      };
    },

    // ── stubbed: backend endpoints don't exist yet (BACKEND_REQUIREMENTS §1/§2) ──

    listTimeseries(): Promise<UserTimeseriesRef[]> {
      return Promise.reject(new NotSupportedError("timeseries API"));
    },
    deleteTimeseries(): Promise<void> {
      return Promise.reject(new NotSupportedError("timeseries API"));
    },
    listWorkflows(): Promise<WorkflowDefinition[]> {
      return Promise.reject(new NotSupportedError("workflows API"));
    },
    saveWorkflow(): Promise<void> {
      return Promise.reject(new NotSupportedError("workflows API"));
    },
  };
}
