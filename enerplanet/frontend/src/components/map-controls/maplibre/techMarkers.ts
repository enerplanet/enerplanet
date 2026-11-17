import type { BuildingTechs } from '@/features/configurator/building-config/buildingTechnologies';
import { HEAT_SUPPLY_TYPES } from '@/features/technologies/catalogue';
import { iconTechKeys } from '@/features/interactive-map/utils/mapStyleUtils';

import type { TechMark } from './techMarksStore';
import type { TechsFor } from './usePvSurfaceIds';

/** An icon above a building's roof in 3D, one per technology as on the 2D map; mark is its legend group. */
export interface TechMarker { icon?: string; mark?: TechMark }

const MARK_OF: Record<string, TechMark> = {
  pv_supply: 'pv',
  battery_storage: 'storage',
  ...Object.fromEntries(HEAT_SUPPLY_TYPES.map((type) => [type, 'heat' as const])),
};

/** The markers of each building with a technology, by osm_id, for the technologies the 2D map draws an icon for. */
export function techMarkersOf(buildings: GeoJSON.FeatureCollection | null, techsFor?: TechsFor): Map<string, TechMarker[]> {
  const out = new Map<string, TechMarker[]>();
  for (const f of buildings?.features ?? []) {
    const osmId = String(f.properties?.osm_id ?? '').trim();
    if (!osmId) continue;
    const techs: BuildingTechs | null | undefined = techsFor ? techsFor(osmId) : f.properties?.techs;
    const markers = iconTechKeys(techs ?? {}).map((key) => ({ icon: techs?.[key]?.icon, mark: MARK_OF[key] }));
    if (markers.length > 0) out.set(osmId, markers);
  }
  return out;
}
