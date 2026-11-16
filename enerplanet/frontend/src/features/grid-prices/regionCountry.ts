import { toLonLat } from "ol/proj";
import { getDataProjection } from "@/features/configurator/utils/gridLayerUtils";
import type { PylovoGridData } from "@/features/configurator/types/area-select";

interface BoxedRegion {
  country?: string;
  bbox?: { west: number; south: number; east: number; north: number };
}

/** The first vertex of a building geometry, in its own projection. */
function firstCoordinate(geometry: GeoJSON.Geometry | null | undefined): number[] | undefined {
  if (geometry?.type === "Point") return geometry.coordinates;
  if (geometry?.type === "Polygon") return geometry.coordinates[0]?.[0];
  if (geometry?.type === "MultiPolygon") return geometry.coordinates[0]?.[0]?.[0];
  return undefined;
}

/** The grid's centre as [lon, lat]: the mean of each building's first vertex. */
export function gridCentre(buildings: PylovoGridData["buildings"]): [number, number] | undefined {
  const points = (buildings?.features ?? []).map((f) => firstCoordinate(f.geometry as GeoJSON.Geometry)).filter((p): p is number[] => !!p);
  if (points.length === 0) return undefined;
  const mean: [number, number] = [points.reduce((s, p) => s + p[0], 0) / points.length, points.reduce((s, p) => s + p[1], 0) / points.length];
  return getDataProjection(buildings) === "EPSG:3857" ? (toLonLat(mean) as [number, number]) : mean;
}

/**
 * The country of the regions whose bounding box holds the point, or undefined when
 * none does or boxes of different countries overlap there.
 */
export function countryAt(regions: BoxedRegion[], [lon, lat]: [number, number]): string | undefined {
  const countries = new Set(
    regions
      .filter((r) => r.country && r.bbox && lon >= r.bbox.west && lon <= r.bbox.east && lat >= r.bbox.south && lat <= r.bbox.north)
      .map((r) => r.country),
  );
  return countries.size === 1 ? [...countries][0] : undefined;
}
