/**
 * The region source the frame installs: pylovo, through EnerPlanET's own backend.
 *
 * The module declares the slot (`modules/model-start/regions.ts`) and never learns which source it has; this is
 * the implementation a host provides, beside the weather source and for the same reason — a module may only
 * depend on `@model-builder/core`, while the app's CSRF-aware axios instance is the app's. The module is told
 * about this one at startup (`setRegionSource`).
 *
 * Read off the legacy service (`configurator/services/pylovoService.ts` → `getAvailableRegions`), keeping the
 * three things that are easy to get wrong:
 *
 * - **The timeout is the legacy's 180 s.** The endpoint scans real grids and is slow; a shorter one would turn
 *   a working-but-slow backend into a failure.
 * - **The answer is cached for a minute and in-flight calls share one promise.** The legacy does both, so a
 *   burst of callers asks the backend once.
 * - **A non-`success` answer is not cached**, so a retry asks again rather than replaying a failure.
 */

import axios from "@/lib/axios";
import type { RegionOption, RegionSource } from "../modules/model-start/regions";

/** The legacy's timeout: long, because `/boundary/available` scans real grids. Never shorten it. */
const REGIONS_TIMEOUT_MS = 180_000;

/** The legacy's cache lifetime — a minute is fresh enough for a list that changes only when data is ingested. */
const REGIONS_CACHE_TTL_MS = 60_000;

/** One entry of the backend's answer, in the endpoint's own spelling. */
interface AvailableRegionEntry {
  country_code: string;
  state_code?: string;
  grid_count: number;
  has_3d?: boolean;
  centroid: { lat: number; lon: number };
  bbox: { west: number; south: number; east: number; north: number };
  region?: { name: string; country: string; country_code: string; state_code?: string };
  boundary?: GeoJSON.Feature;
}

/** The body the proxy wraps: `{ data: { status, regions } }`. */
interface AvailableRegionsBody {
  status: string;
  regions: AvailableRegionEntry[];
}

let cache: { data: readonly RegionOption[]; timestamp: number } | null = null;
let inFlight: Promise<readonly RegionOption[]> | null = null;

/** The backend's entry as the module's option: the code fields are the port's, the name is the label. */
function toOption(entry: AvailableRegionEntry): RegionOption {
  const state = entry.state_code ?? "";
  return {
    country: entry.country_code,
    state,
    label: entry.region?.name ?? (state.length > 0 ? state : entry.country_code),
    bounds: [entry.bbox.west, entry.bbox.south, entry.bbox.east, entry.bbox.north],
  };
}

/** Country first, then name — the grouping-and-sort the legacy's own picker follows. */
function byCountryThenName(a: RegionOption, b: RegionOption): number {
  return a.country.localeCompare(b.country) || a.label.localeCompare(b.label);
}

export const backendRegionSource: RegionSource = {
  async listRegions(): Promise<readonly RegionOption[]> {
    if (cache !== null && Date.now() - cache.timestamp < REGIONS_CACHE_TTL_MS) {
      return cache.data;
    }
    if (inFlight !== null) return inFlight;

    inFlight = axios
      .get<{ data: AvailableRegionsBody }>("/v1/pylovo/boundary/available", { timeout: REGIONS_TIMEOUT_MS })
      .then((response) => {
        const body = response.data?.data;
        const options = (body?.regions ?? []).map(toOption).sort(byCountryThenName);
        // A failed answer is not cached, so a retry asks again.
        if (body?.status === "success") cache = { data: options, timestamp: Date.now() };
        return options;
      })
      .finally(() => {
        inFlight = null;
      });

    return inFlight;
  },
};
