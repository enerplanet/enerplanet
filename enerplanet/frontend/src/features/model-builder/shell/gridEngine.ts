/**
 * The grid engine the frame installs: pylovo, through EnerPlanET's own backend.
 *
 * The module declares the slot (`modules/grid-generation/engine.ts`) and never learns which engine it has; this
 * is the implementation a host provides. It lives in the shell, beside the map host, because it is the frame's
 * business — and because a module may only depend on `@model-builder/core`, while the app's CSRF-aware axios
 * instance is the app's. The module is told about this one at startup (`setGridEngine`).
 *
 * Both facts below were read off the legacy path (`configurator/services/pylovoService.ts` and the grid layers it
 * feeds), not guessed, and both are easy to get wrong:
 *
 * - **The request is EPSG:4326**, `[lon, lat]` — the drawn rings travel straight through.
 * - **The response may not be.** The same endpoint answers in **EPSG:3857** for some areas, and the legacy reads
 *   that off the first coordinate before drawing. Trusting a nominal projection here puts a correctly-shaped grid
 *   on the wrong ground, so each collection is sniffed and converted below (`toLonLat`).
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
import proj4 from "proj4";
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

/**
 * The first coordinate number in a collection, whatever depth the geometry nests to.
 *
 * The tell for the payload's projection: pylovo returns **EPSG:4326** for some areas and **EPSG:3857** for
 * others, and a Web Mercator easting is far too large to be a longitude. The legacy reads the same tell off
 * the first coordinate (`getDataProjection` in its grid layer utils).
 */
function firstCoordinate(collection: GeoJSON.FeatureCollection | undefined): number | null {
  const geometry = collection?.features?.[0]?.geometry;
  let node: unknown = (geometry as { coordinates?: unknown } | null | undefined)?.coordinates;
  while (Array.isArray(node)) node = node[0];
  return typeof node === "number" ? node : null;
}

/** A position is at least a pair; anything beyond that carries elevation or measure, which proj4 preserves. */
type Position = [number, number, ...number[]];

/** Reproject one position; anything that is not a position is walked into. */
function convertNode(node: unknown): unknown {
  if (!Array.isArray(node)) return node;
  return typeof node[0] === "number"
    ? (proj4("EPSG:3857", "EPSG:4326", node as Position) as Position)
    : node.map(convertNode);
}

/** Reproject every position of a geometry, keeping its shape. */
function convertGeometry(geometry: GeoJSON.Geometry): GeoJSON.Geometry {
  return { ...geometry, coordinates: convertNode((geometry as { coordinates: unknown }).coordinates) } as GeoJSON.Geometry;
}

/**
 * pylovo's grid in `[lon, lat]`, whatever projection it came back in.
 *
 * Drawing 3857 as if it were degrees is the failure this prevents: every building and cable lands in the wrong
 * place while still looking like a grid — right shapes, wrong ground. It is worth sniffing rather than trusting
 * a nominal projection, because the same endpoint answers in both.
 */
export function toLonLat(collection: GeoJSON.FeatureCollection): GeoJSON.FeatureCollection {
  const first = firstCoordinate(collection);
  if (first === null || Math.abs(first) <= 180) return collection;

  return {
    ...collection,
    features: collection.features.map((feature) => ({
      ...feature,
      geometry:
        feature.geometry === null ? null : convertGeometry(feature.geometry),
    })) as GeoJSON.Feature[],
  };
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
      buildings: toLonLat(body.buildings),
      transformers: toLonLat(body.transformers),
      lines: toLonLat(body.lines),
      // Absent — not empty — when the area held no buildings; the ports are `FeatureCollection`s either way.
      mvLines: toLonLat(body.mv_lines ?? NO_FEATURES),
      grids: body.grids ?? [],
    };
  },
};
