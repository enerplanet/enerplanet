/**
 * The request behind the building configurator's PV run: the surfaces the
 * view sends, sized by the building's stored PV arrays, at the building's
 * location. See the backend's POST /v1/pv/building-yield.
 */

import type { PvBuildingRunRequest } from '@thd-spatial-ai/building-configurator';

import type { BuildingTech } from './buildingTechnologies';
import { DEFAULT_USABLE_SHARE } from './usePvMode';

/** What the host knows about the open building's PV, besides what the view sends. */
export interface PvYieldContext {
  /** WGS84 [lon, lat] of the building. */
  location: [number, number];
  /** The building's pv_supply technology: its stored arrays and module settings. */
  pv: BuildingTech;
}

export interface PvYieldRequest {
  osm_id: string;
  lat: number;
  lon: number;
  module: Record<string, number>;
  arrays: { surface_id: string; tilt: number; azimuth: number; area: number; usable_share: number }[];
}

// The pv_supply settings the PV simulation reads; the rest are costs and limits.
const MODULE_KEYS = ['losses', 'dc_ac_ratio', 'inv_eff', 'module_type'];

/** Each surface as the view has it, with the usable share stored for it, or the default. */
export function pvYieldRequest(request: PvBuildingRunRequest, context: PvYieldContext): PvYieldRequest {
  const stored = new Map((context.pv.arrays ?? []).map((a) => [a.surface_id, a]));
  const module: Record<string, number> = {};
  for (const key of MODULE_KEYS) {
    const value = context.pv[key];
    if (typeof value === 'number') module[key] = value;
  }
  return {
    osm_id: request.osm_id,
    lon: context.location[0],
    lat: context.location[1],
    module,
    arrays: request.surfaces.map((s) => ({
      surface_id: s.id,
      tilt: s.tilt,
      azimuth: s.azimuth,
      area: s.area,
      usable_share: stored.get(s.id)?.usable_share ?? DEFAULT_USABLE_SHARE,
    })),
  };
}
