import { describe, expect, it } from "vitest";
import { createMockAdapter } from "../../adapter/mock";
import { createEmptyContext } from "../../context/defaults";
import { apply } from "../../context/reducer";
import type { ModelContext } from "../../context/types";
import { autofillDependencies } from "../../engine/autofill";
import {
  availableSlices,
  checkWorkflowContracts,
  firstIncompleteNode,
  isRunnable,
  runNode,
  validateNode,
} from "../../engine/runner";
import type { WorkflowDefinition } from "../../engine/types";
import { defaultPlanningWorkflow, optimizationWorkflow } from "../../engine/workflows/default-planning";

function withGrid(ctx: ModelContext): ModelContext {
  return apply(ctx, {
    type: "set-grid",
    payload: {
      buildings: [{ osmId: "b1", geometry: { type: "Point", coordinates: [0, 0] }, properties: {} }],
    },
  }).next;
}

function withRegion(ctx: ModelContext): ModelContext {
  const polygons: GeoJSON.FeatureCollection = {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
        properties: {},
      },
    ],
  };
  return apply(ctx, { type: "set-region", payload: { polygons } }).next;
}

describe("workflow definitions", () => {
  it("built-in workflows are contract-valid and runnable", () => {
    expect(isRunnable(defaultPlanningWorkflow)).toBe(true);
    expect(isRunnable(optimizationWorkflow)).toBe(true);
  });

  it("flags nodes whose requires are not met upstream", () => {
    const broken: WorkflowDefinition = {
      id: "broken",
      version: 1,
      name: "Broken",
      start: "null",
      nodes: [
        { id: "demand", type: "module:demand" }, // requires grid, nothing provides it
      ],
    };
    const checks = checkWorkflowContracts(broken);
    expect(checks[0].satisfied).toBe(false);
    expect(checks[0].missing).toContain("grid");
  });
});

describe("availableSlices", () => {
  it("reflects which slices hold data", () => {
    const empty = createEmptyContext();
    expect(availableSlices(empty).has("grid")).toBe(false);
    expect(availableSlices(empty).has("meta")).toBe(true); // default title

    const filled = withRegion(withGrid(empty));
    expect(availableSlices(filled).has("grid")).toBe(true);
    expect(availableSlices(filled).has("region")).toBe(true);
  });
});

describe("runner", () => {
  it("blocks a node when the context lacks required slices", async () => {
    const api = createMockAdapter();
    const { report } = await runNode(defaultPlanningWorkflow, "demand", createEmptyContext(), api);
    expect(report.ok).toBe(false);
    expect(report.error).toContain("grid");
  });

  it("demand run fills missing buildings via the adapter", async () => {
    const api = createMockAdapter();
    const { ctx: next, report } = await runNode(defaultPlanningWorkflow, "demand", withGrid(createEmptyContext()), api);
    expect(report.ok).toBe(true);
    expect(next.demand.entries.b1).toEqual({ buildingId: "b1", fClass: "SFH", yearlyKwh: 4000 });
    expect(api.estimateDemandBatch).toHaveBeenCalledOnce();
  });

  it("demand run is a no-op when all buildings have demand", async () => {
    const api = createMockAdapter();
    let ctx = withGrid(createEmptyContext());
    ctx = apply(ctx, { type: "set-demand", payload: { buildingId: "b1", fClass: "SFH", yearlyKwh: 1 } }).next;
    const { report } = await runNode(defaultPlanningWorkflow, "demand", ctx, api);
    expect(report.ok).toBe(true);
    expect(api.estimateDemandBatch).not.toHaveBeenCalled();
  });

  it("run node requires a saved model and sets status running", async () => {
    const api = createMockAdapter();
    let ctx = withRegion(withGrid(createEmptyContext()));
    ctx = apply(ctx, { type: "set-demand", payload: { buildingId: "b1", fClass: "SFH", yearlyKwh: 1 } }).next;

    const unsaved = await runNode(defaultPlanningWorkflow, "run", ctx, api);
    expect(unsaved.report.ok).toBe(true); // requires are met; validate() would block in UI
    expect(validateNode(defaultPlanningWorkflow, "run", ctx).ok).toBe(false); // no id yet

    ctx = apply(ctx, { type: "set-id", payload: { id: 7 } }).next;
    const { ctx: running, report } = await runNode(defaultPlanningWorkflow, "run", ctx, api);
    expect(report.ok).toBe(true);
    expect(running.status).toBe("running");
    expect(api.startCalculation).toHaveBeenCalledWith(7);
  });

  it("results node keeps the previous run for comparison", async () => {
    const api = createMockAdapter();
    let ctx = createEmptyContext();
    ctx = apply(ctx, { type: "set-id", payload: { id: 3 } }).next;
    const first = await runNode(defaultPlanningWorkflow, "results", ctx, api);
    expect(first.ctx.results?.data.pypsa).toBeDefined();

    const second = await runNode(defaultPlanningWorkflow, "results", first.ctx, api);
    expect(second.ctx.results?.previous?.data.pypsa).toBeDefined();
  });

  it("reports adapter errors without throwing", async () => {
    const api = createMockAdapter({
      startCalculation: async () => {
        throw new Error("backend down");
      },
    });
    let ctx = withRegion(withGrid(createEmptyContext()));
    ctx = apply(ctx, { type: "set-demand", payload: { buildingId: "b1", fClass: "SFH", yearlyKwh: 1 } }).next;
    ctx = apply(ctx, { type: "set-id", payload: { id: 1 } }).next;
    const { report } = await runNode(defaultPlanningWorkflow, "run", ctx, api);
    expect(report.ok).toBe(false);
    expect(report.error).toBe("backend down");
  });
});

describe("firstIncompleteNode", () => {
  it("walks to the first failing step", () => {
    const ctx = createEmptyContext();
    expect(firstIncompleteNode(defaultPlanningWorkflow, ctx)).toBe("area-grid");
  });
});

describe("autofill", () => {
  it("inserts area-grid when a loaded context lacks grid for optimization", () => {
    const ctx = createEmptyContext(); // loaded context without region/grid
    const filled = autofillDependencies(optimizationWorkflow, ctx);
    const types = filled.nodes.map((n) => n.type);
    expect(types).toContain("module:area-grid");
    // inserted before its consumer (demand)
    expect(types.indexOf("module:area-grid")).toBeLessThan(types.indexOf("module:demand"));
  });

  it("leaves the workflow untouched when the context satisfies all nodes", () => {
    let ctx = withRegion(withGrid(createEmptyContext()));
    ctx = apply(ctx, { type: "set-demand", payload: { buildingId: "b1", fClass: "SFH", yearlyKwh: 1 } }).next;
    const filled = autofillDependencies(optimizationWorkflow, ctx);
    expect(filled.nodes.map((n) => n.type)).toEqual(optimizationWorkflow.nodes.map((n) => n.type));
  });
});
