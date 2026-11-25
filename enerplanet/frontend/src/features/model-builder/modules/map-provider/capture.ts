/** The rules of a polygon capture, as pure functions. */

/** How close to the first vertex a click must land to close the polygon, in pixels. The legacy's value. */
export const SNAP_DISTANCE_PX = 20;

/** A polygon needs three corners; two is a line, and closing there is not an area. */
export const MIN_VERTICES = 3;

/** Whether a click at this distance from the first vertex closes the polygon. */
export function shouldClose(distancePx: number, vertexCount: number): boolean {
  return vertexCount >= MIN_VERTICES && distancePx < SNAP_DISTANCE_PX;
}

/** The cursor while a capture is running: crosshair normally, pointer when a click would close it. */
export function captureCursor(nearStart: boolean): "pointer" | "crosshair" {
  return nearStart ? "pointer" : "crosshair";
}

/** The radius of the start marker: it grows once a click there would close the polygon. */
export function startMarkerRadius(nearStart: boolean): number {
  return nearStart ? 12 : 8;
}

/** The distance between two pixel positions. */
export function pixelDistance(from: readonly [number, number], to: readonly [number, number]): number {
  return Math.hypot(from[0] - to[0], from[1] - to[1]);
}

/** How close two consecutive corners must be to count as one click landing twice, in pixels. */
export const DUPLICATE_PX = 3;

/** Whether the last corner is a duplicate of the one before it, so closing may drop it. */
export function shouldTrimTail(distancePx: number, vertexCount: number): boolean {
  return vertexCount >= 4 && distancePx < DUPLICATE_PX;
}
