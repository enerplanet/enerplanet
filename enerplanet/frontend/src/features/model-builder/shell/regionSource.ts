/**
 * The region source the frame installs: the legacy's own pylovo service.
 *
 * The module declares the slot (`modules/model-start/regions.ts`) and never learns which source it has. It
 * goes through `pylovoService.getAvailableRegions()`, so the two lists cannot drift apart and there is one
 * cache rather than two.
 */

import { pylovoService } from "@/features/configurator/services/pylovoService";

import type { RegionOption, RegionSource } from "../modules/model-start/regions";

/** One entry of the backend's answer, in the endpoint's own spelling. */
interface AvailableRegionEntry {
  country_code: string;
  state_code?: string;
  bbox: { west: number; south: number; east: number; north: number };
  region?: { name: string };
}

/** Country first, then name — the grouping-and-sort the legacy's own picker follows. */
function byCountryThenName(a: RegionOption, b: RegionOption): number {
  return a.country.localeCompare(b.country) || a.label.localeCompare(b.label);
}

/** The backend's entry as the module's option: the code fields are the port's, the name is the label. */
function toOption(entry: AvailableRegionEntry): RegionOption {
  const state = entry.state_code ?? "";
  return {
    country: entry.country_code,
    state,
    // A region with no name of its own falls back to its code rather than rendering an empty row.
    label: entry.region?.name ?? (state.length > 0 ? state : entry.country_code),
    bounds: [entry.bbox.west, entry.bbox.south, entry.bbox.east, entry.bbox.north],
  };
}

export const backendRegionSource: RegionSource = {
  async listRegions(): Promise<readonly RegionOption[]> {
    const response = await pylovoService.getAvailableRegions();

    // The legacy's own hook treats anything but `success` as a failure so its query layer can retry.
    if (response.status !== "success") {
      throw new Error(`the region list answered status '${response.status}'`);
    }

    return (response.regions as AvailableRegionEntry[]).map(toOption).sort(byCountryThenName);
  },
};
