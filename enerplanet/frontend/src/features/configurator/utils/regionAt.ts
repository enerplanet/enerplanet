import GeoJSON from "ol/format/GeoJSON";

interface ListedRegion {
  bbox?: { west: number; south: number; east: number; north: number };
  region?: { name: string };
  boundary?: GeoJSON.Feature | null;
}

/**
 * The region from GET /v1/pylovo/boundary/available that holds [lon, lat]
 * (EPSG:4326): the one whose boundary contains it, else the only one whose
 * bounding box does. Undefined when none does, or boxes overlap there and no
 * boundary decides.
 */
export function regionAt<R extends ListedRegion>(regions: R[], [lon, lat]: [number, number]): R | undefined {
  const named = regions.filter((r) => r.region?.name);
  const format = new GeoJSON();
  const inside = named.find((r) => r.boundary?.geometry && format.readGeometry(r.boundary.geometry).intersectsCoordinate([lon, lat]));
  if (inside) return inside;
  const boxed = named.filter((r) => r.bbox && lon >= r.bbox.west && lon <= r.bbox.east && lat >= r.bbox.south && lat <= r.bbox.north);
  return boxed.length === 1 ? boxed[0] : undefined;
}
