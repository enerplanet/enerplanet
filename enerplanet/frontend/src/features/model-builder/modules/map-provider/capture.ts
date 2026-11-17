/**
 * The rules of a polygon capture, as pure functions.
 *
 * These live apart from the canvas because they are the two things a capture gets wrong: nothing closes, or the
 * cursor lies about what a click will do. Both are decisions about pixels and counts, so both can be pinned
 * without a browser.
 *
 * The behaviour is deliberately the legacy drawer's (`features/polygon-drawer/PolygonDrawer.tsx`): a start marker
 * that grows within `SNAP_DISTANCE`, and the cursor naming what a click would do.
 */

/** How close to the first vertex a click must land to close the polygon, in pixels. The legacy's value. */
export const SNAP_DISTANCE_PX = 20;

/** A polygon needs three corners; two is a line, and closing there is not an area. */
export const MIN_VERTICES = 3;

/**
 * Whether a click at this distance from the first vertex closes the polygon.
 *
 * Strictly nearer than the snap distance, matching the legacy (`distance < SNAP_DISTANCE`), so the constant
 * itself is *not* in range — a click exactly 20 px away places a vertex.
 */
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

/**
 * Whether the last corner is a duplicate of the one before it, so closing may drop it.
 *
 * A double-click places its second corner on top of its first. Closing on that pair would leave a zero-length
 * edge in the ring. But removing a corner *unconditionally* is worse: "draw three corners and double-click to
 * finish" then loses a real one, the polygon has too few corners to close, and the capture hangs with nothing
 * on screen to explain it. Never below four corners, so the trim can only ever remove the extra click.
 */
export function shouldTrimTail(distancePx: number, vertexCount: number): boolean {
  return vertexCount >= 4 && distancePx < DUPLICATE_PX;
}
