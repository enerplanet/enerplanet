/** Shared building element types and helpers used across configure and overview UI. */

export type BuildingElementSource = 'city' | 'default' | 'custom';

export interface BuildingElement {
  id: string;
  label: string;
  type: 'wall' | 'window' | 'roof' | 'floor' | 'door';
  area: number;
  uValue: number;
  gValue: number | null;
  tilt: number;
  azimuth: number;
  source?: BuildingElementSource;
  customMode?: boolean;
  dInsulation?: number;
  bTransmission?: number;
  measureType?: string;
  measureTypeOptions?: string[];
  /** Snapshot of the imported/default values — stamped once, never changed. Used to show reset buttons. */
  defaultTilt?: number;
  defaultAzimuth?: number;
  defaultArea?: number;
  defaultUValue?: number;
}

/** A group selection: one surface type on one face of the building. */
export interface FaceGroup {
  type: BuildingElement['type'];
  face: string;
  elementId?: string;
}

/** Maps a wall azimuth (degrees) to one of 8 canonical face id strings (45° buckets). */
export function faceFromAzimuth(azimuth: number): string {
  const faces = [
    'north_wall', 'northeast_wall', 'east_wall', 'southeast_wall',
    'south_wall', 'southwest_wall', 'west_wall', 'northwest_wall',
  ];
  const normalized = ((azimuth % 360) + 360) % 360;
  return faces[Math.round(normalized / 45) % 8];
}

/** Roofs with very low tilt are treated as a single top-facing group. */
export function roofFaceFromElement(el: Pick<BuildingElement, 'tilt' | 'azimuth'>): string {
  return el.tilt <= 10 ? 'roof' : faceFromAzimuth(el.azimuth);
}

/** Maps any building element to its FaceGroup for viz and list synchronisation. */
export function elementToGroup(el: BuildingElement): FaceGroup {
  if (el.type === 'roof') return { type: 'roof', face: roofFaceFromElement(el), elementId: el.id };
  if (el.type === 'floor') return { type: 'floor', face: 'floor' };
  return { type: el.type, face: faceFromAzimuth(el.azimuth) };
}

/** Ensures all elements carry explicit source and edit-mode metadata. */
export function normalizeElementRecord(
  elements: Record<string, BuildingElement>,
  fallbackSource: BuildingElementSource,
): Record<string, BuildingElement> {
  return Object.fromEntries(
    Object.entries(elements).map(([id, el]) => [
      id,
      {
        ...el,
        source: el.source ?? fallbackSource,
        customMode: el.customMode ?? (el.source === 'custom'),
        // Stamp defaults once — preserve any already-set snapshot (e.g. from a loaded file).
        defaultTilt:    el.defaultTilt    ?? el.tilt,
        defaultAzimuth: el.defaultAzimuth ?? el.azimuth,
        defaultArea:    el.defaultArea    ?? el.area,
        defaultUValue:  el.defaultUValue  ?? el.uValue,
      },
    ]),
  );
}

/** Source-derived elements are read-only until promoted into custom mode. */
export function isElementEditable(el: BuildingElement): boolean {
  return el.source === 'custom' || !!el.customMode;
}

/** Returns true when the element is either custom-created or custom-overridden. */
export function isUserDefinedElement(el: BuildingElement): boolean {
  return el.source === 'custom' || !!el.customMode;
}

/**
 * A zero (or negative) area can't be simulated — BuEM rejects it outright.
 * Surfaces imported from real 3D extraction occasionally carry a degenerate
 * sliver like this; surfaced here rather than silently dropped so the user
 * can fix or delete it before running a simulation.
 */
export function hasInvalidArea(el: BuildingElement): boolean {
  return !(el.area > 0);
}