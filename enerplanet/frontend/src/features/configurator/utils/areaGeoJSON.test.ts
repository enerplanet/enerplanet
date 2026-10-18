import { describe, expect, it } from "vitest";

import { AreaImportError, areaRingsFromGeoJSON } from "./areaGeoJSON";

const square = [[12.95, 48.83], [12.96, 48.83], [12.96, 48.84], [12.95, 48.84], [12.95, 48.83]];

describe("areaRingsFromGeoJSON", () => {
  it("reads a WGS84 polygon as an open [lon, lat] ring", () => {
    const rings = areaRingsFromGeoJSON(JSON.stringify({ type: "Polygon", coordinates: [square] }));
    expect(rings).toHaveLength(1);
    expect(rings[0]).toHaveLength(4);
    expect(rings[0][0][0]).toBeCloseTo(12.95, 9);
    expect(rings[0][0][1]).toBeCloseTo(48.83, 9);
  });

  it("takes the outer ring of every polygon in a feature collection", () => {
    const hole = [[12.952, 48.832], [12.953, 48.832], [12.953, 48.833], [12.952, 48.832]];
    const collection = {
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: {}, geometry: { type: "MultiPolygon", coordinates: [[square, hole], [square]] } },
        { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [12.95, 48.83] } },
      ],
    };
    expect(areaRingsFromGeoJSON(JSON.stringify(collection))).toHaveLength(2);
  });

  it("converts a QGIS export in EPSG:25832", () => {
    const utm = [[790000, 5415700], [790700, 5415700], [790700, 5416750], [790000, 5416750], [790000, 5415700]];
    const doc = { type: "FeatureCollection", crs: { type: "name", properties: { name: "urn:ogc:def:crs:EPSG::25832" } },
      features: [{ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [utm] } }] };
    const [ring] = areaRingsFromGeoJSON(JSON.stringify(doc));
    expect(ring[0][0]).toBeGreaterThan(12.9);
    expect(ring[0][0]).toBeLessThan(13.0);
    expect(ring[0][1]).toBeGreaterThan(48.8);
    expect(ring[0][1]).toBeLessThan(48.9);
  });

  it("rejects invalid JSON, files without a polygon and unknown systems", () => {
    expect(() => areaRingsFromGeoJSON("not json")).toThrow(AreaImportError);
    expect(() => areaRingsFromGeoJSON(JSON.stringify({ type: "Point", coordinates: [1, 2] }))).toThrow("noPolygon");
    expect(() => areaRingsFromGeoJSON(JSON.stringify({ type: "Polygon", coordinates: [square], crs: { type: "name", properties: { name: "EPSG:9999" } } }))).toThrow("unknownCrs");
  });
});
