import { describe, expect, it } from "vitest";

import { regionAt } from "./regionAt";

const square = (w: number, s: number, e: number, n: number): GeoJSON.Feature => ({
  type: "Feature",
  properties: {},
  geometry: { type: "Polygon", coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] },
});

// Two regions whose boxes overlap between lon 9 and 10; only their outlines tell them apart there.
const west = { region: { name: "West" }, bbox: { west: 6, south: 47, east: 10, north: 50 }, boundary: square(6, 47, 9.5, 50) };
const east = { region: { name: "East" }, bbox: { west: 9, south: 47, east: 13, north: 50 }, boundary: square(9.5, 47, 13, 50) };

describe("regionAt", () => {
  it("picks the region whose outline holds the point where boxes overlap", () => {
    expect(regionAt([west, east], [9.7, 48])?.region.name).toBe("East");
    expect(regionAt([west, east], [9.2, 48])?.region.name).toBe("West");
  });

  it("falls back to the only box holding the point when no outline does", () => {
    const noOutline = { ...west, boundary: null };
    expect(regionAt([noOutline, east], [7, 48])?.region.name).toBe("West");
  });

  it("finds nothing outside every region", () => {
    expect(regionAt([west, east], [20, 48])).toBeUndefined();
  });
});
