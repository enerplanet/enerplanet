import { fromLonLat } from "ol/proj";
import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import { point, polygon } from "@turf/helpers";

/**
 * Given an arbitrary nested coordinate structure (e.g. GeoJSON coordinates),
 * finds the bounding box and returns the center projected to EPSG:3857.
 * Returns null if no valid coordinates are found.
 */
export const getMapProjectedCenterFromAnyCoordinates = (
  coordinates: unknown
): [number, number] | null => {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  const visit = (value: unknown) => {
    if (!Array.isArray(value)) return;
    if (
      value.length >= 2 &&
      typeof value[0] === "number" &&
      typeof value[1] === "number" &&
      Number.isFinite(value[0]) &&
      Number.isFinite(value[1])
    ) {
      const x = value[0];
      const y = value[1];
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      return;
    }
    value.forEach(visit);
  };

  visit(coordinates);
  if (
    !Number.isFinite(minX) ||
    !Number.isFinite(minY) ||
    !Number.isFinite(maxX) ||
    !Number.isFinite(maxY)
  ) {
    return null;
  }

  const centerLonOrX = (minX + maxX) / 2;
  const centerLatOrY = (minY + maxY) / 2;

  // If coordinate looks like lon/lat, project to map projection.
  if (Math.abs(centerLonOrX) <= 180 && Math.abs(centerLatOrY) <= 90) {
    const projected = fromLonLat([centerLonOrX, centerLatOrY]);
    return [projected[0], projected[1]];
  }
  return [centerLonOrX, centerLatOrY];
};

/**
 * Returns true if the given [lon, lat] coordinate lies inside any of the
 * provided polygons (each polygon is an array of [lon, lat] vertices).
 * Uses @turf/boolean-point-in-polygon which handles winding order correctly.
 */
export const isCoordinateInsidePolygons = (
  lonLat: [number, number],
  polygons: [number, number][][]
): boolean => {
  if (polygons.length === 0) return false;
  const pt = point(lonLat);
  for (const poly of polygons) {
    if (!poly || poly.length < 3) continue;
    try {
      // @turf/boolean-point-in-polygon handles winding order correctly
      // Close the ring if needed (turf requires it)
      const ring = [...poly];
      const first = ring[0];
      const last = ring[ring.length - 1];
      if (first[0] !== last[0] || first[1] !== last[1]) {
        ring.push([first[0], first[1]]);
      }
      const polyGeom = polygon([ring]);
      if (booleanPointInPolygon(pt, polyGeom)) return true;
    } catch {
      // Ignore malformed polygons
    }
  }
  return false;
};

export const getClusterKeyFromProps = (
  props: Record<string, any> | null | undefined
): string | null => {
  if (!props) return null;
  const rawId =
    props.grid_result_id ??
    props.transformer_id ??
    props.trafo_id ??
    props.cluster_id ??
    props.id;
  if (rawId === undefined || rawId === null) return null;
  if (typeof rawId === "number" && Number.isFinite(rawId)) {
    return `n:${rawId}`;
  }
  const rawText = String(rawId).trim();
  if (!rawText) return null;
  const num = Number(rawText);
  if (Number.isFinite(num)) {
    return `n:${num}`;
  }
  return `s:${rawText}`;
};
