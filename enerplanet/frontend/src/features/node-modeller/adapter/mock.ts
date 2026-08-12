/**
 * Mock adapter for tests (Plan P2/P4, README_V2 §7.2).
 * Every method is a vi.fn-compatible stub with sane defaults; override per test.
 */
import { vi } from "vitest";
import type { ModelContext } from "../context/types";
import { builtinWorkflows } from "../engine/workflows/default-planning";
import type { BackendAdapter, DemandEstimate, DemandEstimateInput, GenerateGridResult } from "./types";

export function createMockAdapter(overrides: Partial<BackendAdapter> = {}): BackendAdapter {
  const base: BackendAdapter = {
    listModels: vi.fn(async () => []),
    getModelContext: vi.fn(async (id: number) => {
      throw new Error(`no mock model ${id}`);
    }),
    saveModel: vi.fn(async () => 1),
    updateModel: vi.fn(async () => { }),
    generateGrid: vi.fn(async (): Promise<GenerateGridResult> => ({
      buildings: [
        {
          osmId: "b1",
          geometry: { type: "Point", coordinates: [0, 0] } as GeoJSON.Geometry,
          properties: {},
        },
      ],
      lines: [],
      mvLines: [],
      transformers: [],
    })),
    getBoundary: vi.fn(
      async () =>
        ({
          type: "Feature",
          geometry: { type: "Point", coordinates: [0, 0] },
          properties: {},
        }) as GeoJSON.Feature,
    ),
    gridStatistics: vi.fn(async () => ({})),
    estimateDemandBatch: vi.fn(async (inputs: DemandEstimateInput[]): Promise<DemandEstimate[]> =>
      inputs.map((i) => ({ buildingId: i.buildingId, fClass: "SFH", yearlyKwh: 4000 })),
    ),
    listTechnologies: vi.fn(async () => [{ id: "solar", name: "Solar PV" }]),
    startCalculation: vi.fn(async () => { }),
    getResults: vi.fn(async (modelId: number) => ({
      data: { pypsa: { ok: true } },
      runId: modelId,
      finishedAt: new Date().toISOString(),
    })),
    listTimeseries: vi.fn(async () => []),
    deleteTimeseries: vi.fn(async () => { }),
    listWorkflows: vi.fn(async () => builtinWorkflows),
    saveWorkflow: vi.fn(async () => { }),
  };
  return { ...base, ...overrides };
}

export type { ModelContext };
