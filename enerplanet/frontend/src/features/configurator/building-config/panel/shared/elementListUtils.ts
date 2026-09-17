// Utilities for grouping and describing building envelope elements.
// Used by ElementCompositionSection (overview) and surface group editing (configure).

import type { BuildingElement } from '@/features/configurator/building-config/panel/configure/model/buildingElements';
import type { RoofConfig } from '@/features/configurator/building-config/panel/configure/model/roof';

// ─── Face group ───────────────────────────────────────────────────────────────

/** All elements of the same type facing the same compass direction form one face group. */
export interface FaceGroupSummary {
  type: BuildingElement['type'];
  /** Canonical face id: e.g. 'north_wall', 'southeast_wall', 'roof', 'floor'. */
  face: string;
  label: string;
  count: number;
  totalArea: number;
  /** Area-weighted average U-value across all elements in the group. */
  avgUValue: number;
}

const FACE_ORDER = [
  'north_wall', 'northeast_wall', 'east_wall', 'southeast_wall',
  'south_wall', 'southwest_wall', 'west_wall', 'northwest_wall',
];

const DIRECTION_LABELS: Record<string, string> = {
  north_wall: 'North', northeast_wall: 'NE',
  east_wall: 'East',   southeast_wall: 'SE',
  south_wall: 'South', southwest_wall: 'SW',
  west_wall: 'West',   northwest_wall: 'NW',
};

const TYPE_DISPLAY_ORDER: BuildingElement['type'][] = ['wall', 'roof', 'floor', 'window', 'door'];

/** Maps azimuth (degrees) to the canonical 8-direction face id. */
function azimuthToFace(azimuth: number): string {
  const normalized = ((azimuth % 360) + 360) % 360;
  return FACE_ORDER[Math.round(normalized / 45) % 8];
}

function roofToFace(el: Pick<BuildingElement, 'tilt' | 'azimuth'>): string {
  return el.tilt <= 10 ? 'roof' : azimuthToFace(el.azimuth);
}

function faceGroupLabel(type: BuildingElement['type'], face: string): string {
  if (type === 'roof') {
    if (face === 'roof') return 'Roof';
    const dir = DIRECTION_LABELS[face] ?? face;
    return `${dir} Roof`;
  }
  if (type === 'floor') return 'Floor';
  const dir = DIRECTION_LABELS[face] ?? face;
  if (type === 'wall')   return `${dir} Wall`;
  if (type === 'window') return `${dir} Windows`;
  if (type === 'door')   return `${dir} Doors`;
  return face;
}

/**
 * Returns all face-level groups that exist in the elements record,
 * sorted by element type then compass direction.
 */
export function getFaceGroups(elements: Record<string, BuildingElement>): FaceGroupSummary[] {
  const map = new Map<string, BuildingElement[]>();

  for (const el of Object.values(elements)) {
    let face: string;
    if (el.type === 'roof')       face = roofToFace(el);
    else if (el.type === 'floor') face = 'floor';
    else                          face = azimuthToFace(el.azimuth);

    const key = `${el.type}::${face}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(el);
  }

  const groups: FaceGroupSummary[] = [];
  for (const [key, items] of map.entries()) {
    const [type, face] = key.split('::') as [BuildingElement['type'], string];
    const totalArea = items.reduce((s, el) => s + el.area, 0);
    const avgUValue = totalArea > 0
      ? items.reduce((s, el) => s + el.uValue * el.area, 0) / totalArea
      : (items[0]?.uValue ?? 0);
    groups.push({ type, face, label: faceGroupLabel(type, face), count: items.length, totalArea, avgUValue });
  }

  return groups.sort((a, b) => {
    const ti = TYPE_DISPLAY_ORDER.indexOf(a.type) - TYPE_DISPLAY_ORDER.indexOf(b.type);
    if (ti !== 0) return ti;
    const fa = FACE_ORDER.indexOf(a.face);
    const fb = FACE_ORDER.indexOf(b.face);
    return (fa === -1 ? 99 : fa) - (fb === -1 ? 99 : fb);
  });
}

export type ElementGroupKey = 'wall' | 'window' | 'door' | 'roof' | 'floor';

export const ELEMENT_GROUP_LABELS: Record<ElementGroupKey, string> = {
  wall:   'Walls',
  window: 'Windows',
  door:   'Doors',
  roof:   'Roof',
  floor:  'Floor',
};

/** Partitions the elements record into buckets by type. */
export function getGroupedElements(
  elements: Record<string, BuildingElement>,
): Record<ElementGroupKey, BuildingElement[]> {
  return {
    wall:   Object.values(elements).filter((el) => el.type === 'wall'),
    window: Object.values(elements).filter((el) => el.type === 'window'),
    door:   Object.values(elements).filter((el) => el.type === 'door'),
    roof:   Object.values(elements).filter((el) => el.type === 'roof'),
    floor:  Object.values(elements).filter((el) => el.type === 'floor'),
  };
}

/**
 * Returns a short shape description for the roof configuration.
 * Does NOT include a surface count — callers should use the actual element count instead.
 */
export function getRoofGroupInfo(roofConfig: RoofConfig): { description: string } {
  const descriptions: Record<string, string> = {
    flat:         'low-slope',
    'mono-pitch': 'single slope',
    gabled:       'S + N',
    hipped:       'S/N/E/W',
    'v-shape':    'inward slopes',
    'saw-tooth':  'S-facing',
    custom:       'custom',
  };

  return {
    description: descriptions[roofConfig.type] ?? roofConfig.type,
  };
}
