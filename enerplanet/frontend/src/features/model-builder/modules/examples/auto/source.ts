/**
 * The area-summary slot — the one piece of I/O `example-auto` has, and where a host would put a real
 * implementation.
 *
 * The module declares that it *can* summarise a drawn area and never learns how the summary is made: the job
 * is a function of the rings alone, so the module takes the answer from an injected source and knows nothing
 * about projections, tiling or a backend. That is the same slot shape `building-demand` uses, with one
 * deliberate difference.
 *
 * **This example ships a working default.** `building-demand`'s slot starts empty and a host *must* install
 * one, because a demand estimate comes from a service nobody can reimplement locally. An area summary is pure
 * geometry, so the example carries its own deterministic implementation and runs with **no host at all** —
 * which is what lets the module be developed and tested in isolation. A real module whose I/O genuinely
 * leaves the process would, like `building-demand`, have no default and *require* a host to install one; this
 * one does not, precisely so it can serve as the auto-path template without an app behind it.
 *
 * The exported installer is the seam a host replaces it through. Passing `null` restores the default, so a
 * test can reset the slot without re-deriving the module's behaviour.
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

/**
 * How long the default source takes. Deliberate, not cosmetic: a real source's answer arrives later than the
 * frame's render, so the run's states have to be visible. A source that resolved synchronously would hide the
 * running state entirely, and a module developed against that would break the moment a real service — with
 * real latency — was installed in its place.
 */
const LOCAL_DELAY_MS = 400;

/**
 * Summarise the rings. Pure and total, so the same rings always give the same summary — which is what lets a
 * second run with an unchanged input commit nothing.
 */
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
