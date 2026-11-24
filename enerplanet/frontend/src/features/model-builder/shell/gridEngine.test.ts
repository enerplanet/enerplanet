/**
 * The grid engine's one piece of real judgement: pylovo answers in two different projections.
 *
 * The legacy sniffs the same tell — a coordinate too large to be a longitude means Web Mercator — and converts
 * before drawing. Getting this wrong does not look like an error: the grid keeps its shape and lands on the
 * wrong ground, which is a bug that reads as "pylovo generated nonsense" rather than "we drew it wrong".
 */

import { describe, expect, it } from "vitest";
import { toLonLat } from "./gridEngine";

/** A one-feature collection at the given coordinate. */
const at = (coordinates: number[]): GeoJSON.FeatureCollection => ({
  type: "FeatureCollection",
  features: [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates } }],
});

const pointOf = (collection: GeoJSON.FeatureCollection): number[] =>
  (collection.features[0].geometry as GeoJSON.Point).coordinates;

describe("toLonLat", () => {
  // Hesse, in Web Mercator — the shape pylovo actually answered with.
  const MERCATOR: number[] = [960000, 6000000];
  const LON_LAT: number[] = [8.6, 49.4];

  it("converts a Web Mercator collection to lon/lat", () => {
    const [lon, lat] = pointOf(toLonLat(at(MERCATOR)));

    // Ranges, not a hand-written pair: the assertion is that these are degrees near the drawn area, which is
    // what Web Mercator's numbers can never be. 960000 easting really is ~8.62°.
    expect(lon).toBeGreaterThan(8);
    expect(lon).toBeLessThan(9);
    expect(lat).toBeGreaterThan(46);
    expect(lat).toBeLessThan(51);
  });

  it("leaves a lon/lat collection exactly as it found it", () => {
    const collection = at(LON_LAT);

    // Identity, not a copy: a degree pair that needs no work is not touched.
    expect(toLonLat(collection)).toBe(collection);
  });

  it("reads the tell through nested geometry, not just the first pair", () => {
    const line: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {},
          geometry: { type: "LineString", coordinates: [MERCATOR, [960100, 6000100]] },
        },
      ],
    };

    const [first] = (toLonLat(line).features[0].geometry as GeoJSON.LineString).coordinates;
    expect(Math.abs(first[0])).toBeLessThan(180);
  });

  it("survives an empty collection", () => {
    const none: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

    expect(toLonLat(none)).toBe(none);
  });

  it("reprojects a polygon ring without disturbing its shape", () => {
    const ring: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {},
          geometry: {
            type: "Polygon",
            coordinates: [[MERCATOR, [960100, 6000100], [960100, 6000000], MERCATOR]],
          },
        },
      ],
    };

    const converted = toLonLat(ring).features[0].geometry as GeoJSON.Polygon;
    expect(converted.type).toBe("Polygon");
    expect(converted.coordinates[0]).toHaveLength(4);
    expect(Math.abs(converted.coordinates[0][0][0])).toBeLessThan(180);
  });
});
