/**
 * PV arrays sized by the building configurator's module layout: whole modules
 * of the building's PV type fitted inside each surface. The layout gives the
 * panels' own angles, the module count and the capacity EnerPlanET stores and
 * simulates, so the map, the 3D view and the run agree.
 */

import { pvLayout, type PvModule, type SurfacePolygon } from '@thd-spatial-ai/building-configurator';

import type { PvArray, PvSurfaceRow } from './usePvMode';

/**
 * The array with its module layout on the surface's polygon: panel tilt and
 * facing, module count and capacity. Without a polygon (a surface of another
 * 3D building, not in the view's geometry) the array keeps its stored values,
 * and the backend sizes it by area.
 */
export function arrayWithLayout(array: PvArray, polygon: SurfacePolygon | undefined, module: PvModule): PvArray {
  if (!polygon) return array;
  const layout = pvLayout(polygon, module, {
    usableShare: array.usable_share,
    mounting: array.mounting,
    orientation: array.orientation,
  });
  return {
    ...array,
    tilt: layout.tilt,
    azimuth: layout.azimuth,
    modules: layout.count,
    capacity_kw: Math.round(layout.kwp * 1000) / 1000,
  };
}

/**
 * Best-fit arrays on the building's qualifying roofs at one usable share,
 * mounting and orientation left to the configurator's defaults. A roof too
 * small for a single module gets no array.
 */
export function bestFitArrays(
  rows: readonly PvSurfaceRow[],
  polygons: readonly SurfacePolygon[],
  usableShare: number,
  module: PvModule,
): PvArray[] {
  const byId = new Map(polygons.map((p) => [p.id, p]));
  return rows
    .filter((row) => row.qualifies)
    .map((row) => arrayWithLayout(
      { surface_id: row.surface_id, tilt: row.tilt, azimuth: row.azimuth, area: row.area, usable_share: usableShare },
      byId.get(row.surface_id),
      module,
    ))
    .filter((array) => array.modules === undefined || array.modules > 0);
}

