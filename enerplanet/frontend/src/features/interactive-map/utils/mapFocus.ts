import { boundingExtent } from 'ol/extent';

export type LonLat = [number, number];

export type CentreTarget =
  | { kind: 'area'; extent: number[] }
  | { kind: 'location'; lonLat: LonLat };

/** Every [lon, lat] pair in nested coordinate arrays (drawn polygons or a GeoJSON MultiPolygon). */
export function lonLatPoints(coordinates: unknown): LonLat[] {
  if (!Array.isArray(coordinates)) return [];
  if (coordinates.length >= 2 && typeof coordinates[0] === 'number' && typeof coordinates[1] === 'number') {
    return [[coordinates[0], coordinates[1]]];
  }
  return coordinates.flatMap(lonLatPoints);
}

/** Where the centre button goes: the model's area when the page has one, else the saved start location. */
export function centreTarget(area: LonLat[], location: { latitude: number; longitude: number }): CentreTarget {
  if (area.length > 0) return { kind: 'area', extent: boundingExtent(area) };
  return { kind: 'location', lonLat: [location.longitude, location.latitude] };
}
