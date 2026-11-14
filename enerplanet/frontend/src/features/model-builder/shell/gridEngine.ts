/**
 * The grid engine the frame installs: pylovo, through EnerPlanET's own backend.
 *
 * The module declares the slot (`modules/grid-generation/engine.ts`) and never learns which engine it has; this
 * is the implementation a host provides. It lives in the shell, beside the map host, because it is the frame's
 * business — and because a module may only depend on `@model-builder/core`, while the app's CSRF-aware axios
 * instance is the app's. The module is told about this one at startup (`setGridEngine`).
 *
 * Both facts below were read off the legacy path (`configurator/services/pylovoService.ts`), not guessed, and
 * both are easy to get wrong:
 *
 * - **The wire is EPSG:4326.** `[lon, lat]` in, `[lon, lat]` out. EPSG:3035 appears only *inside* pylovo, for
 *   its own database joins; it is never the coordinate system of the request or the response. Nothing here
 *   reprojects — which is exactly why `area-draw`'s `coordinates` travel straight through.
 * - **Bodies are wrapped.** The Go proxy returns `{ success, data }`, so the grid is at `response.data.data`.
 *
 * Two deliberate departures from legacy:
 *
 * - `include_private_buildings: false` is sent explicitly. The server defaults it to **true**, which would fold
 *   other users' private custom buildings into this model's grid.
 * - A real timeout is set. Legacy leaves it at `0`, so a hung generation blocks a browser tab forever; a module
 *   whose whole job is re-runnable should fail instead and say so.
 */

import axios from "@/lib/axios";
import type { Coordinates } from "@model-builder/core";
import type { GridEngine, GridRequest, GridResult } from "../modules/grid-generation/engine";

/** Long enough for a large area, short enough that a hung backend is a visible failure rather than a wait. */
const GRID_TIMEOUT_MS = 120_000;

/** pylovo's own spelling of the grid body — snake_case, and `mv_lines` may be absent entirely. */
interface PylovoGridBody {
  status?: string;
  buildings: GeoJSON.FeatureCollection;
  transformers: GeoJSON.FeatureCollection;
  lines: GeoJSON.FeatureCollection;
  mv_lines?: GeoJSON.FeatureCollection;
  grids?: unknown;
}

/** An empty collection, for the one field pylovo omits when an area turns out to hold no buildings. */
const NO_FEATURES: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

/**
 * The drawn rings as the `geom` pylovo wants: one ring is a Polygon, several are a MultiPolygon — the same
 * choice the legacy service makes from its `polygon` / `polygons` fields.
 */
function geomOf(coordinates: Coordinates): GeoJSON.Polygon | GeoJSON.MultiPolygon {
  return coordinates.length === 1
    ? { type: "Polygon", coordinates }
    : { type: "MultiPolygon", coordinates: coordinates.map((ring) => [ring]) };
}

export const pylovoGridEngine: GridEngine = {
  async generate({ coordinates }: GridRequest): Promise<GridResult> {
    // `region` is not sent: the area carries all the locality pylovo needs, and the backend resolves the
    // rest itself. It stays in the request because the module must be able to say what a grid belongs to.
    const response = await axios.post<{ success: boolean; data: PylovoGridBody }>(
      "/v1/pylovo/generate-grid",
      { geom: geomOf(coordinates), include_private_buildings: false },
      { timeout: GRID_TIMEOUT_MS },
    );

    const body = response.data.data;

    return {
      buildings: body.buildings,
      transformers: body.transformers,
      lines: body.lines,
      // Absent — not empty — when the area held no buildings; the ports are `FeatureCollection`s either way.
      mvLines: body.mv_lines ?? NO_FEATURES,
      grids: body.grids ?? [],
    };
  },
};
