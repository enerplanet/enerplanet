/**
 * The grid engine the frame installs: pylovo, through EnerPlanET's own backend.
 *
 * The module declares the slot (`modules/grid-generation/engine.ts`) and never learns which engine it has.
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

/** The drawn rings as the `geom` pylovo wants: one ring is a Polygon, several are a MultiPolygon. */
function geomOf(coordinates: Coordinates): GeoJSON.Polygon | GeoJSON.MultiPolygon {
  return coordinates.length === 1
    ? { type: "Polygon", coordinates }
    : { type: "MultiPolygon", coordinates: coordinates.map((ring) => [ring]) };
}

/** The first coordinate number in a collection, whatever depth the geometry nests to. */
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

/** pylovo's grid in `[lon, lat]`, whatever projection it came back in. */
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
    // `region` is not sent: the area carries all the locality pylovo needs, and the backend resolves the rest.
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
