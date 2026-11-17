/**
 * The grid engine — this module's **provider slot**.
 *
 * The module is a blackbox whose contract is only the GeoJSON it produces, and its engine is a *slot*:
 * `pylovo-grid` by default, "or any engine emitting the identical shape". So the
 * engine is an interface here, `pylovo.ts` is one implementation, and a test — or another host — may supply
 * another. Nothing above this line may know which one it is.
 *
 * The shape is deliberate in one respect: an engine returns **all five port values or throws**. A grid of half
 * a network is not a grid, and the module writes in one transaction, so partial success is not a state the
 * module has to represent — the type simply has no room for it.
 */

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
  /**
   * The grid ids present in the response — pylovo emits `[{ grid_result_id }]` and nothing more, which is why
   * `ModelData.grids` is `unknown`. The counts and levels come from a separate backend call, not from here.
   */
  grids: unknown;
}

/**
 * A grid engine. Implementations may call a backend, read a file, or synthesise a grid — the module cannot
 * tell, and must not try.
 */
export interface GridEngine {
  generate(request: GridRequest): Promise<GridResult>;
}
