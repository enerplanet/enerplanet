import GeoJSON from "ol/format/GeoJSON";
import { MultiPolygon, Polygon } from "ol/geom";
import { get as getProjection } from "ol/proj";
import { register } from "ol/proj/proj4";
import proj4 from "proj4";

import { polygonsToGeom } from "@/features/configurator/services/pylovoService";

/** Projected systems of the countries EnerPlanET covers, as QGIS exports them. */
const PROJ_DEFS: Record<string, string> = {
  "EPSG:25832": "+proj=utm +zone=32 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs",
  "EPSG:25833": "+proj=utm +zone=33 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs",
  "EPSG:31468": "+proj=tmerc +lat_0=0 +lon_0=12 +k=1 +x_0=4500000 +y_0=0 +ellps=bessel +towgs84=598.1,73.7,418.2,0.202,0.045,-2.455,6.7 +units=m +no_defs +type=crs",
  "EPSG:28992": "+proj=sterea +lat_0=52.1561605555556 +lon_0=5.38763888888889 +k=0.9999079 +x_0=155000 +y_0=463000 +ellps=bessel +towgs84=565.4171,50.3319,465.5524,1.9342,-1.6677,9.1019,4.0725 +units=m +no_defs +type=crs",
  "EPSG:31256": "+proj=tmerc +lat_0=0 +lon_0=16.3333333333333 +k=1 +x_0=0 +y_0=-5000000 +ellps=bessel +towgs84=577.326,90.129,463.919,5.137,1.474,5.297,2.4232 +units=m +no_defs +type=crs",
  "EPSG:5514": "+proj=krovak +lat_0=49.5 +lon_0=24.8333333333333 +alpha=30.2881397527778 +k=0.9999 +x_0=0 +y_0=0 +ellps=bessel +towgs84=589,76,480,0,0,0,0 +units=m +no_defs +type=crs",
};
Object.entries(PROJ_DEFS).forEach(([code, def]) => proj4.defs(code, def));
register(proj4);

// Limits matching the backend's geo.ValidateArea (backend/internal/geo/area.go),
// which enforces them; keep the two in step.
export const MAX_AREA_POLYGONS = 100;
export const MAX_AREA_VERTICES = 10000;
/** Larger files are refused before they are read. */
export const MAX_AREA_FILE_BYTES = 5 * 1024 * 1024;

/** The nine types RFC 7946 defines; any other top-level type is not GeoJSON. */
const GEOJSON_TYPES = new Set([
  "FeatureCollection", "Feature", "GeometryCollection",
  "Point", "MultiPoint", "LineString", "MultiLineString", "Polygon", "MultiPolygon",
]);

type AreaImportReason = "invalid" | "notGeoJSON" | "tooLarge" | "noPolygon" | "tooComplex" | "outOfRange" | "unknownCrs";

/** A GeoJSON file that cannot be used as a model area, with the reason as a message key. */
export class AreaImportError extends Error {
  readonly reason: AreaImportReason;
  readonly detail: string;

  constructor(reason: AreaImportReason, detail = "") {
    super(`${reason}${detail ? `: ${detail}` : ""}`);
    this.reason = reason;
    this.detail = detail;
  }
}

/** The EPSG code a GeoJSON crs member names, or EPSG:4326 when it names none. */
function crsOf(doc: { crs?: { properties?: { name?: string } } }): string {
  const name = doc.crs?.properties?.name;
  if (!name || /CRS84$/i.test(name)) return "EPSG:4326";
  const code = /EPSG:{1,2}(\d+)$/i.exec(name)?.[1];
  if (!code) throw new AreaImportError("unknownCrs", name);
  return `EPSG:${code}`;
}

/**
 * The area as a GeoJSON FeatureCollection in EPSG:4326 with closed rings, the
 * form areaRingsFromGeoJSON reads back, so another model can start from it.
 */
export function areaToGeoJSON(polygons: [number, number][][], name: string): string {
  const feature = { type: "Feature", properties: { name }, geometry: polygonsToGeom(polygons) };
  return JSON.stringify({ type: "FeatureCollection", features: [feature] });
}

/**
 * The outer rings of every Polygon and MultiPolygon in a GeoJSON text, as
 * [lon, lat] rings without the closing point, the form drawn areas take. Holes
 * are dropped, because an area is selected by its outline.
 */
export function areaRingsFromGeoJSON(text: string): [number, number][][] {
  let doc: { type?: unknown; crs?: { properties?: { name?: string } } };
  try {
    doc = JSON.parse(text);
  } catch {
    throw new AreaImportError("invalid");
  }
  if (typeof doc !== "object" || doc === null || !GEOJSON_TYPES.has(doc.type as string)) {
    throw new AreaImportError("notGeoJSON", String(doc?.type ?? ""));
  }
  const crs = crsOf(doc);
  if (!getProjection(crs)) throw new AreaImportError("unknownCrs", crs);

  const features = new GeoJSON().readFeatures(doc, { dataProjection: crs, featureProjection: "EPSG:4326" });
  const rings: [number, number][][] = [];
  for (const feature of features) {
    const geometry = feature.getGeometry();
    const polygons = geometry instanceof MultiPolygon ? geometry.getPolygons() : geometry instanceof Polygon ? [geometry] : [];
    for (const polygon of polygons) {
      const outer = polygon.getLinearRing(0)?.getCoordinates() ?? [];
      const open = outer.slice(0, -1).map(([lon, lat]) => [lon, lat] as [number, number]);
      if (open.length >= 3) rings.push(open);
    }
  }
  if (rings.length === 0) throw new AreaImportError("noPolygon");
  checkAreaRings(rings);
  return rings;
}

/** Applies the backend's limits and the WGS84 range, which a file in metres without a crs member fails. */
function checkAreaRings(rings: [number, number][][]): void {
  const vertices = rings.reduce((n, r) => n + r.length, 0);
  if (rings.length > MAX_AREA_POLYGONS || vertices > MAX_AREA_VERTICES) {
    throw new AreaImportError("tooComplex", `${rings.length} / ${vertices}`);
  }
  for (const [lon, lat] of rings.flat()) {
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lon) > 180 || Math.abs(lat) > 90) {
      throw new AreaImportError("outOfRange", `${lon}, ${lat}`);
    }
  }
}

/** Reads a chosen file as an area, refusing other file types and oversized files before reading them. */
export async function readAreaFile(file: File): Promise<[number, number][][]> {
  if (!/\.(geo)?json$/i.test(file.name)) throw new AreaImportError("notGeoJSON", file.name);
  if (file.size > MAX_AREA_FILE_BYTES) throw new AreaImportError("tooLarge", `${Math.ceil(file.size / 1048576)} MB`);
  return areaRingsFromGeoJSON(await file.text());
}
