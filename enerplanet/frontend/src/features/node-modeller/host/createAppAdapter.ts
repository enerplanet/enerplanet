/**
 * Host seam — the ONLY file in this feature allowed to import app code.
 *
 * Wires the real BackendAdapter to the app's axios instance and the backend
 * model shape. Everything else in node-modeller stays import-free of the app
 * (Plan decisions 4/5; README_V2 §7.1).
 */
import http from "@/lib/axios";
import { createHttpAdapter } from "../adapter/http";
import type { BackendAdapter } from "../adapter/types";
import { createEmptyContext } from "../context/defaults";
import type { ModelContext } from "../context/types";

/** Backend model row → context (best-effort; refined as P5 lands). */
function hydrateModel(raw: unknown): ModelContext {
  const m = (raw ?? {}) as Record<string, unknown>;
  const ctx = createEmptyContext();
  return {
    ...ctx,
    id: m.id as number | undefined,
    parentId: (m.parent_model_id as number | undefined) ?? undefined,
    meta: {
      ...ctx.meta,
      title: (m.title as string) ?? ctx.meta.title,
      description: (m.description as string) ?? undefined,
      fromDate: (m.from_date as string) ?? undefined,
      toDate: (m.to_date as string) ?? undefined,
      resolution: (m.resolution as string) ?? ctx.meta.resolution,
      workspaceId: (m.workspace_id as string) ?? undefined,
    },
    // TODO(P5): hydrate region/grid/pypsa from m.coordinates / m.grids once
    // the exact backend payload mapping is ported from the configurator save flow.
  };
}

/** Context → backend save payload (best-effort; refined as P5 lands). */
function serializeModel(ctx: ModelContext): unknown {
  return {
    title: ctx.meta.title,
    description: ctx.meta.description,
    from_date: ctx.meta.fromDate,
    to_date: ctx.meta.toDate,
    resolution: ctx.meta.resolution,
    workspace_id: ctx.meta.workspaceId,
    parent_model_id: ctx.parentId,
    coordinates: ctx.region.polygons,
    grids: ctx.grid.grids,
    // TODO(P5): full payload parity with the configurator's saveAreaData.
  };
}

export function createAppAdapter(): BackendAdapter {
  return createHttpAdapter({ http, hydrateModel, serializeModel });
}
