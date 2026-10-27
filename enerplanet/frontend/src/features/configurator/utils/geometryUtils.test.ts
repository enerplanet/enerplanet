import { describe, expect, it } from "vitest";

import { isCoordinateInsidePolygons } from "./geometryUtils";

// A square of about 1.1 km at Deggendorf; 0.001 degrees of latitude is about 111 m.
const square: [number, number][][] = [[[12.95, 48.83], [12.96, 48.83], [12.96, 48.84], [12.95, 48.84]]];

describe("isCoordinateInsidePolygons with a margin", () => {
    it("accepts a point about 111 m outside only within a 200 m margin", () => {
        const outside: [number, number] = [12.955, 48.841];

        expect(isCoordinateInsidePolygons(outside, square)).toBe(false);
        expect(isCoordinateInsidePolygons(outside, square, 200)).toBe(true);
    });

    it("rejects a point about 333 m outside", () => {
        expect(isCoordinateInsidePolygons([12.955, 48.843], square, 200)).toBe(false);
    });
});
