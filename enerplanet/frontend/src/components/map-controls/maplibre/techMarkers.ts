import type { BuildingTechs } from '@/features/configurator/building-config/buildingTechnologies';
import { HEAT_SUPPLY_TYPES } from '@/features/technologies/catalogue';

import type { TechsFor } from './usePvSurfaceIds';

/** A marker above a building's roof in 3D, one per kind of technology it has. */
export type TechMarker = 'storage' | 'heat';

const MARKER_OF: Record<string, TechMarker> = {
  battery_storage: 'storage',
  ...Object.fromEntries(HEAT_SUPPLY_TYPES.map((type) => [type, 'heat' as const])),
};

/** The markers of each building with storage or a heat technology, by osm_id; PV is drawn on its roofs instead. */
export function techMarkersOf(buildings: GeoJSON.FeatureCollection | null, techsFor?: TechsFor): Map<string, TechMarker[]> {
  const out = new Map<string, TechMarker[]>();
  for (const f of buildings?.features ?? []) {
    const osmId = String(f.properties?.osm_id ?? '').trim();
    if (!osmId) continue;
    const techs: BuildingTechs | null | undefined = techsFor ? techsFor(osmId) : f.properties?.techs;
    const markers = [...new Set(Object.keys(techs ?? {}).map((key) => MARKER_OF[key]).filter(Boolean))].sort();
    if (markers.length > 0) out.set(osmId, markers);
  }
  return out;
}
