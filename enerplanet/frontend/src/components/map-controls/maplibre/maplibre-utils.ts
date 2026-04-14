import { transform } from 'ol/proj';

/**
 * Extract the first coordinate from any GeoJSON geometry (for projection detection).
 */
function getFirstCoord(geometry: any): number[] | null {
  if (!geometry) return null;
  let coords = geometry.coordinates;
  while (Array.isArray(coords) && Array.isArray(coords[0]) && Array.isArray(coords[0][0])) {
    coords = coords[0];
  }
  if (Array.isArray(coords) && Array.isArray(coords[0])) coords = coords[0];
  return Array.isArray(coords) && typeof coords[0] === 'number' ? coords : null;
}

/**
 * Auto-detect source projection from coordinate ranges.
 */
function detectProjection(geojson: any): string {
  const c = getFirstCoord(geojson?.features?.[0]?.geometry);
  if (!c) return 'EPSG:4326';
  if (c[0] > 180 || c[0] < -180) {
    return c[0] > 2_000_000 ? 'EPSG:3035' : 'EPSG:3857';
  }
  return 'EPSG:4326';
}

/**
 * Reproject a GeoJSON FeatureCollection to WGS84 (EPSG:4326) for MapLibre.
 * Handles Point, MultiPoint, LineString, MultiLineString, Polygon, MultiPolygon.
 */
export function reprojectGeoJSON(geojson: any): GeoJSON.FeatureCollection | null {
  if (!geojson?.features?.length) return null;
  const srcProj = detectProjection(geojson);
  if (srcProj === 'EPSG:4326') return geojson;
  const rc = (c: number[]) => transform([c[0], c[1]], srcProj, 'EPSG:4326') as number[];
  const rr = (ring: number[][]) => ring.map(rc);
  const reprojected: GeoJSON.Feature[] = [];
  for (const f of geojson.features) {
    const g = f.geometry;
    if (!g) continue;
    let newGeom: any;
    switch (g.type) {
      case 'Point': newGeom = { type: 'Point', coordinates: rc(g.coordinates) }; break;
      case 'MultiPoint': newGeom = { type: 'MultiPoint', coordinates: g.coordinates.map(rc) }; break;
      case 'LineString': newGeom = { type: 'LineString', coordinates: rr(g.coordinates) }; break;
      case 'MultiLineString': newGeom = { type: 'MultiLineString', coordinates: g.coordinates.map(rr) }; break;
      case 'Polygon': newGeom = { type: 'Polygon', coordinates: g.coordinates.map(rr) }; break;
      case 'MultiPolygon': newGeom = { type: 'MultiPolygon', coordinates: g.coordinates.map((p: any) => p.map(rr)) }; break;
      default: continue;
    }
    reprojected.push({ ...f, geometry: newGeom });
  }
  return { type: 'FeatureCollection', features: reprojected };
}
