/**
 * PV arrays sized by the building configurator's module layout: whole modules
 * of the building's PV type fitted inside each surface. The layout gives the
 * panels' own angles, the module count and the capacity EnerPlanET stores and
 * simulates, so the map, the 3D view and the run agree.
 */

import {
  pvLayout,
  surfacesFromGeometryResponse,
  type BuildingGeometry,
  type PvModule,
  type SurfacePolygon,
} from '@thd-spatial-ai/building-configurator';

import axios from '@/lib/axios';

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

/** Where a building is: its City2TABULA country, or a WGS84 point to resolve it from. */
export type BuildingPlace = { country: string } | { lon: number; lat: number };

/**
 * Fetches the building's PV surfaces and the geometry of each 3D building
 * behind its qualifying roofs, and returns the best-fit arrays with the
 * country the surfaces came from, for the next building's request.
 */
export async function fetchBestFitArrays(
  osmId: string,
  place: BuildingPlace,
  usableShare: number,
  module: PvModule,
): Promise<{ country: string; arrays: PvArray[] }> {
  const { data } = await axios.get<{ country: string; surfaces: PvSurfaceRow[] }>('/v1/city2tabula/pv-surfaces', {
    params: { osm_id: osmId, ...place },
  });
  const objectIds = new Set(data.surfaces.filter((r) => r.qualifies && r.object_id).map((r) => r.object_id!));
  const polygons: SurfacePolygon[] = [];
  // The geometry route serves one 3D building per call.
  for (const objectId of objectIds) {
    const res = await axios.get<{ buildings: BuildingGeometry[] }>('/v1/city2tabula/geometry', {
      params: { country: data.country, object_ids: objectId },
    });
    polygons.push(...surfacesFromGeometryResponse(res.data.buildings ?? []));
  }
  return { country: data.country, arrays: bestFitArrays(data.surfaces, polygons, usableShare, module) };
}
