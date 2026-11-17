/**
 * Test-only fixtures and factories. Not a test file itself — imported by `*.test.ts`.
 *
 * Kept deliberately free of shared mutable state: every test builds its own store.
 */

import { PortWriteRejected } from "./errors";
import type { ModelData } from "./ports";

export function fc(features: GeoJSON.Feature[] = []): GeoJSON.FeatureCollection {
  return { type: "FeatureCollection", features };
}

export function building(osmId: string): GeoJSON.Feature {
  return {
    type: "Feature",
    properties: { osmId },
    geometry: { type: "Point", coordinates: [8.68, 49.41] },
  };
}

/** A store's initial projection: identity + an empty grid. */
export function seed(overrides: Partial<ModelData> = {}): ModelData {
  return {
    modelName: "Contract fixture",
    fromDate: "2025-01-01",
    toDate: "2025-12-31",
    resolution: 60,
    coordinates: [],
    buildings: fc(),
    ...overrides,
  };
}

/** Runs a promise expected to reject and returns the rejection for inspection. */
export async function captureError<T extends Error = PortWriteRejected>(
  promise: Promise<unknown>,
): Promise<T> {
  try {
    await promise;
  } catch (err) {
    return err as T;
  }
  throw new Error("expected the call to reject, but it resolved");
}
