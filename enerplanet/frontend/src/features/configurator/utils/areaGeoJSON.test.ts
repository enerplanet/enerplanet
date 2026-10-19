import { describe, expect, it } from "vitest";

import { AreaImportError, MAX_AREA_FILE_BYTES, MAX_AREA_VERTICES, areaRingsFromGeoJSON, areaToGeoJSON, readAreaFile } from "./areaGeoJSON";

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

describe("areaToGeoJSON", () => {
  it("writes an area that areaRingsFromGeoJSON reads back unchanged", () => {
    const rings: [number, number][][] = [
      [[12.95, 48.83], [12.96, 48.83], [12.96, 48.84]],
      [[12.89, 48.80], [12.90, 48.80], [12.90, 48.81], [12.89, 48.81]],
    ];
    const text = areaToGeoJSON(rings, "Mainkofen");

    expect(JSON.parse(text).features[0].properties.name).toBe("Mainkofen");
    expect(areaRingsFromGeoJSON(text)).toEqual(rings);
  });
});

describe("area import checks", () => {
  const reasonOf = (fn: () => unknown) => {
    try { fn(); } catch (e) { return (e as AreaImportError).reason; }
    return "accepted";
  };

  it("refuses JSON that is not GeoJSON", () => {
    expect(reasonOf(() => areaRingsFromGeoJSON(`{"name":"x","type":"Topology"}`))).toBe("notGeoJSON");
    expect(reasonOf(() => areaRingsFromGeoJSON(`[1,2,3]`))).toBe("notGeoJSON");
  });

  it("refuses metre coordinates in a file that names no coordinate system", () => {
    const metres = `{"type":"Polygon","coordinates":[[[780000,5410000],[781000,5410000],[781000,5411000],[780000,5410000]]]}`;
    expect(reasonOf(() => areaRingsFromGeoJSON(metres))).toBe("outOfRange");
  });

  it("refuses an area over the backend's vertex limit", () => {
    const ring = Array.from({ length: MAX_AREA_VERTICES + 2 }, (_, i) => [12 + i * 1e-6, 48 + (i % 2) * 1e-3]);
    const text = JSON.stringify({ type: "Polygon", coordinates: [[...ring, ring[0]]] });
    expect(reasonOf(() => areaRingsFromGeoJSON(text))).toBe("tooComplex");
  });

  it("refuses other file types and oversized files before reading them", async () => {
    const square = JSON.stringify({ type: "Polygon", coordinates: [[[12.95, 48.83], [12.96, 48.83], [12.96, 48.84], [12.95, 48.83]]] });
    await expect(readAreaFile(new File([square], "area.exe"))).rejects.toMatchObject({ reason: "notGeoJSON" });
    const big = new File([square], "area.geojson");
    Object.defineProperty(big, "size", { value: MAX_AREA_FILE_BYTES + 1 });
    await expect(readAreaFile(big)).rejects.toMatchObject({ reason: "tooLarge" });
    await expect(readAreaFile(new File([square], "area.geojson"))).resolves.toHaveLength(1);
  });
});
