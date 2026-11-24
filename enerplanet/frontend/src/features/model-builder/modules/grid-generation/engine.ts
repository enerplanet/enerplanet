/** The grid engine — this module's provider slot. */

import type { Coordinates, RegionRef } from "@model-builder/core";

/** What the module asks an engine for: the drawn area, and the region it sits in. */
export interface GridRequest {
  coordinates: Coordinates;
  region: RegionRef;
}

/** What an engine hands back: exactly the ports this module produces, nothing else. */
export interface GridResult {
  /** Buildings, as features whose `osm_id` is the key other data (3D surfaces, demand) joins on. */
  buildings: GeoJSON.FeatureCollection;
  transformers: GeoJSON.FeatureCollection;
  /** Low voltage. Features carry `line_id`, `grid_result_id`, `line_name`, `cable_type`, `length_km`. */
  lines: GeoJSON.FeatureCollection;
  /** Medium voltage. Features carry `mv_line_id`, `from_transformer`, `to_transformer`, `length_km`. */
  mvLines: GeoJSON.FeatureCollection;
  /** The grid ids present in the response (pylovo emits `[{ grid_result_id }]`); `ModelData.grids` is `unknown`. */
  grids: unknown;
}

/** A grid engine: implementations may call a backend, read a file, or synthesise a grid. */
export interface GridEngine {
  generate(request: GridRequest): Promise<GridResult>;
}
