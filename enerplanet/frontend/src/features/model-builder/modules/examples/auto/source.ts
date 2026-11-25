/**
 * The area-summary slot — the one piece of I/O `example-auto` has.
 *
 * The module summarises a drawn area through an injected source. Unlike the slots that call a backend:
 * This example ships a working default — the example carries its own deterministic implementation — so it
 * runs with no host at all. `null` restores the default.
 */

import type { Coordinates } from "@model-builder/core";

/** A small, obviously derived description of the area the user drew. */
export interface AreaSummary {
  /** How many polygons were drawn. */
  ringCount: number;
  /** How many points in total, across every ring. */
  pointCount: number;
  /** The lon/lat box the rings span, or `null` for an empty draw. */
  bounds: { minLon: number; minLat: number; maxLon: number; maxLat: number } | null;
  /** The mean of the drawn points, `[lon, lat]`, or `null` for an empty draw. */
  centroid: [number, number] | null;
}

/** What a host provides, and what the module depends on: rings in, a summary out. */
export interface AreaSummarySource {
  summarise(rings: Coordinates): Promise<AreaSummary>;
}

/** How long the default source takes — deliberate, so the run's states are visible (a real source has latency). */
const LOCAL_DELAY_MS = 400;

/** Summarise the rings. Pure and total, so the same rings always give the same summary. */
function summariseRings(rings: Coordinates): AreaSummary {
  let pointCount = 0;
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  let sumLon = 0;
  let sumLat = 0;

  for (const ring of rings) {
    for (const [lon, lat] of ring) {
      pointCount += 1;
      minLon = Math.min(minLon, lon);
      maxLon = Math.max(maxLon, lon);
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
      sumLon += lon;
      sumLat += lat;
    }
  }

  if (pointCount === 0) {
    return { ringCount: rings.length, pointCount: 0, bounds: null, centroid: null };
  }

  return {
    ringCount: rings.length,
    pointCount,
    bounds: { minLon, minLat, maxLon, maxLat },
    centroid: [sumLon / pointCount, sumLat / pointCount],
  };
}

/** The example's own source: the real geometry, computed locally, behind a short and deliberate delay. */
const localSource: AreaSummarySource = {
  async summarise(rings) {
    await new Promise((resolve) => setTimeout(resolve, LOCAL_DELAY_MS));
    return summariseRings(rings);
  },
};

let source: AreaSummarySource = localSource;

/** Replace the source. A host calls this at startup; `null` puts the example's own default back. */
export function setAreaSummarySource(next: AreaSummarySource | null): void {
  source = next ?? localSource;
}

/** The installed source. Never null: the example always has one, so it always runs. */
export function areaSummarySource(): AreaSummarySource {
  return source;
}
