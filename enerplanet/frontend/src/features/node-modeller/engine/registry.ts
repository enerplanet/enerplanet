/**
 * Built-in node module registry (Plan P2).
 *
 * Modules here are headless: validation + async run only. The React UI for
 * each node lives in `../nodes/` (P3+) and binds to these contracts by id.
 */
import type { ModelContext } from "../context/types";
import type { NodeModule } from "./types";
import { invalid, valid } from "./types";

function hasBuildings(ctx: ModelContext): boolean {
  return ctx.grid.buildings.length > 0;
}

function hasPolygons(ctx: ModelContext): boolean {
  return (ctx.region.polygons?.features.length ?? 0) > 0;
}

export const modelSettingsModule: NodeModule = {
  id: "module:model-settings",
  label: "Model Settings",
  requires: [],
  // pypsa: advanced parameters live in the settings node (README_V2 §6.1).
  provides: ["meta", "pypsa"],
  validate(ctx) {
    return ctx.meta.title.trim().length > 0
      ? valid
      : invalid({ path: "/meta/title", message: "Title is required" });
  },
};

export const areaGridModule: NodeModule = {
  id: "module:area-grid",
  label: "Area & Grid",
  requires: ["meta"],
  provides: ["region", "grid"],
  validate(ctx) {
    if (!hasPolygons(ctx)) return invalid({ path: "/region/polygons", message: "Draw at least one area" });
    if (!hasBuildings(ctx)) return invalid({ path: "/grid/buildings", message: "Generate the grid first" });
    return valid;
  },
  async run(ctx, api) {
    // Refresh grid statistics badge data; generation itself is user-triggered from the UI.
    if (!hasBuildings(ctx)) return ctx;
    try {
      await api.gridStatistics(ctx);
    } catch {
      // statistics are advisory — never block the workflow
    }
    return ctx;
  },
};

export const demandModule: NodeModule = {
  id: "module:demand",
  label: "Demand",
  requires: ["grid"],
  provides: ["demand"],
  validate(ctx) {
    const missing = ctx.grid.buildings.filter((b) => !ctx.demand.entries[b.osmId]);
    return missing.length === 0
      ? valid
      : invalid({ path: "/demand/entries", message: `${missing.length} building(s) without demand` });
  },
  async run(ctx, api) {
    // User timeseries overrides (Aspect 4) are applied here once the backend
    // exists; until then everything falls back to batch estimates.
    const missing = ctx.grid.buildings.filter((b) => !ctx.demand.entries[b.osmId]);
    if (missing.length === 0) return ctx;
    const estimates = await api.estimateDemandBatch(
      missing.map((b) => ({ buildingId: b.osmId, properties: b.properties })),
    );
    let next = ctx;
    const { apply } = await import("../context/reducer");
    for (const e of estimates) {
      next = apply(next, { type: "set-demand", payload: e }).next;
    }
    return next;
  },
};

export const technologiesModule: NodeModule = {
  id: "module:technologies",
  label: "Technologies",
  requires: ["grid", "demand"],
  provides: ["techAssignments"],
  // Assignments are optional — an unassigned model is still runnable.
  validate: () => valid,
};

export const runModule: NodeModule = {
  id: "module:run",
  label: "Run Model",
  requires: ["meta", "region", "grid", "demand", "techAssignments", "pypsa"],
  provides: [],
  validate(ctx) {
    return ctx.id !== undefined
      ? valid
      : invalid({ path: "/id", message: "Model must be saved before running" });
  },
  async run(ctx, api) {
    if (ctx.id === undefined) return ctx;
    const { apply } = await import("../context/reducer");
    await api.startCalculation(ctx.id);
    return apply(ctx, { type: "set-status", payload: "running" }).next;
  },
};

export const resultsModule: NodeModule = {
  id: "module:results",
  label: "Results",
  requires: [],
  provides: ["results"],
  validate(ctx) {
    return ctx.results ? valid : invalid({ path: "/results", message: "No results yet" });
  },
  async run(ctx, api) {
    if (ctx.id === undefined) return ctx;
    const results = await api.getResults(ctx.id);
    if (!results) return ctx;
    const { apply } = await import("../context/reducer");
    // Keep the previous run for comparison (Aspect 5).
    const prev = ctx.results ? { data: ctx.results.data, runId: ctx.results.runId, finishedAt: ctx.results.finishedAt } : undefined;
    return apply(ctx, {
      type: "set-results",
      payload: { ...results, previous: results.previous ?? prev },
    }).next;
  },
};

const MODULES: Record<string, NodeModule> = Object.fromEntries(
  [modelSettingsModule, areaGridModule, demandModule, technologiesModule, runModule, resultsModule].map(
    (m) => [m.id, m],
  ),
);

export function getModule(type: string): NodeModule {
  const mod = MODULES[type];
  if (!mod) throw new Error(`Unknown node module: ${type}`);
  return mod;
}

export function listModules(): NodeModule[] {
  return Object.values(MODULES);
}
