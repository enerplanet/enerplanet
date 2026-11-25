/** A capture's rules: closing, trimming, cursor and marker, without a browser. */
import { describe, expect, it } from "vitest";
import {
  DUPLICATE_PX,
  MIN_VERTICES,
  SNAP_DISTANCE_PX,
  captureCursor,
  pixelDistance,
  shouldClose,
  shouldTrimTail,
  startMarkerRadius,
} from "./capture";

describe("closing on the first vertex", () => {
  it("closes when a click lands inside the snap distance with three corners placed", () => {
    expect(shouldClose(SNAP_DISTANCE_PX - 1, 3)).toBe(true);
    expect(shouldClose(0, 5)).toBe(true);
  });

  it("does not close outside the snap distance", () => {
    expect(shouldClose(SNAP_DISTANCE_PX, 4)).toBe(false);
    expect(shouldClose(SNAP_DISTANCE_PX + 1, 4)).toBe(false);
  });

  it("does not close a line, however close the click is", () => {
    // Two corners is not an area, so a stray click on the start point cannot close a degenerate polygon.
    expect(shouldClose(0, 2)).toBe(false);
    expect(shouldClose(0, 1)).toBe(false);
    expect(shouldClose(0, 0)).toBe(false);
  });

  it("uses three corners as the floor, not two", () => {
    expect(MIN_VERTICES).toBe(3);
  });
});

describe("what the cursor promises", () => {
  it("is a crosshair while placing corners", () => {
    expect(captureCursor(false)).toBe("crosshair");
  });

  it("becomes a pointer exactly when a click would close the polygon", () => {
    // The cursor is the affordance: it must agree with shouldClose, or it lies about what the next click does.
    for (const vertices of [0, 3, 7]) {
      for (const distance of [0, SNAP_DISTANCE_PX - 1, SNAP_DISTANCE_PX, SNAP_DISTANCE_PX + 5]) {
        const closes = shouldClose(distance, vertices);
        expect(captureCursor(closes)).toBe(closes ? "pointer" : "crosshair");
      }
    }
  });
});

describe("the start marker", () => {
  it("grows once a click there would close the polygon", () => {
    expect(startMarkerRadius(false)).toBeLessThan(startMarkerRadius(true));
  });
});

describe("pixel distance", () => {
  it("is the distance on screen, not between coordinates", () => {
    expect(pixelDistance([0, 0], [3, 4])).toBeCloseTo(5, 10);
    expect(pixelDistance([10, 10], [10, 10])).toBe(0);
  });
});

describe("the double-click's duplicate corner", () => {
  it("is trimmed when it lands on the corner before it", () => {
    // Four corners where the last two coincide: three real corners plus the pair, so the pair goes.
    expect(shouldTrimTail(0.5, 4)).toBe(true);
    expect(shouldTrimTail(DUPLICATE_PX - 0.1, 6)).toBe(true);
  });

  it("is never trimmed below four corners, because three is a polygon", () => {
    // The bug this guards: three corners and a double-click to finish must close, not lose a corner.
    expect(shouldTrimTail(0, 3)).toBe(false);
    expect(shouldTrimTail(0, 2)).toBe(false);
  });

  it("leaves a real corner alone when it is not a duplicate", () => {
    expect(shouldTrimTail(DUPLICATE_PX, 4)).toBe(false);
    expect(shouldTrimTail(40, 5)).toBe(false);
  });
});
