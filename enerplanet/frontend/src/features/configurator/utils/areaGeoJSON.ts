import GeoJSON from "ol/format/GeoJSON";
import { MultiPolygon, Polygon } from "ol/geom";
import { get as getProjection } from "ol/proj";
import { register } from "ol/proj/proj4";
import proj4 from "proj4";

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

/** A GeoJSON file that cannot be used as a model area, with the reason as a message key. */
export class AreaImportError extends Error {
  readonly reason: "invalid" | "noPolygon" | "unknownCrs";
  readonly detail: string;

  constructor(reason: "invalid" | "noPolygon" | "unknownCrs", detail = "") {
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
 * The outer rings of every Polygon and MultiPolygon in a GeoJSON text, as
 * [lon, lat] rings without the closing point, the form drawn areas take. Holes
 * are dropped, because an area is selected by its outline.
 */
export function areaRingsFromGeoJSON(text: string): [number, number][][] {
  let doc: { crs?: { properties?: { name?: string } } };
  try {
    doc = JSON.parse(text);
  } catch {
    throw new AreaImportError("invalid");
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
  return rings;
}
