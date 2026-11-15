/**
 * The demand-estimate source the frame installs: pylovo, through EnerPlanET's own backend.
 *
 * The module declares the slot (`modules/building-demand/source.ts`) and never learns which source it has;
 * this is the implementation a host provides, beside the grid engine and the weather source and for the same
 * reason — a module may only depend on `@model-builder/core`, while the app's CSRF-aware axios instance is the
 * app's. The module is told about this one at startup (`setDemandSource`).
 *
 * Read off the legacy service (`configurator/services/energyService.ts`), including the two things that are
 * easy to get wrong:
 *
 * - **The response is unwrapped twice.** The Go proxy returns `{ success, data }`, and the estimate endpoint's
 *   own payload may *also* be `{ status: "success", data: … }`. The legacy checks for that second layer before
 *   reading the row, and so does this.
 * - **The class it answers with may differ from the one asked for.** The service resolves a profile and reports
 *   the class it actually used, which is what the heat mirror then looks up — so the answer, not the request,
 *   decides the heat rate.
 *
 * One request per building, because that is what the legacy does: the batch endpoint exists but has no callers.
 */

import axios from "@/lib/axios";
import { normalizeFClass } from "../modules/building-demand/heat";
import type { DemandEstimateSource } from "../modules/building-demand/source";

/** Long enough for a cold service, short enough that an unresponsive one is visible rather than a wait. */
const ESTIMATE_TIMEOUT_MS = 30_000;

/** pylovo's own spelling of the request body. */
interface EstimateBody {
  building_type: string;
  area_m2: number;
  year_of_construction: number | null;
  household_size?: number;
  num_floors: number | null;
  energy_label: string | null;
  hot_water_electric: boolean;
}

/** A number from an untrusted field, or undefined. */
function numberOf(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** The row itself, after however many envelopes it arrived in. */
function rowOf(payload: unknown): Record<string, unknown> {
  let result = payload;
  if (
    result !== null &&
    typeof result === "object" &&
    "data" in result &&
    "status" in result &&
    (result as Record<string, unknown>).status === "success"
  ) {
    result = (result as Record<string, unknown>).data;
  }
  return result !== null && typeof result === "object" ? (result as Record<string, unknown>) : {};
}

export const pylovoDemandSource: DemandEstimateSource = {
  async estimate(attributes) {
    const body: EstimateBody = {
      building_type: attributes.buildingType,
      area_m2: attributes.areaM2,
      year_of_construction: attributes.yearOfConstruction ?? null,
      ...(attributes.householdSize === undefined ? {} : { household_size: attributes.householdSize }),
      num_floors: attributes.numFloors ?? null,
      energy_label: attributes.energyLabel ?? null,
      // The legacy's dialog can ask for electric hot water; nothing in the flow does yet.
      hot_water_electric: false,
    };

    const response = await axios.post<{ success: boolean; data: unknown }>(
      "/v1/pylovo/estimate-energy",
      body,
      { timeout: ESTIMATE_TIMEOUT_MS },
    );

    const row = rowOf(response.data.data);

    // The class the service *used* — normalised the same way the heat mirror normalises it, so the lookup
    // that follows actually finds the rate the backend would have used.
    const fClass = normalizeFClass(String(row.f_class ?? row.parsed_class ?? attributes.buildingType)) || "unknown";

    return {
      fClass,
      yearlyKwh: numberOf(row.yearly_demand_kwh) ?? 0,
      peakKw: numberOf(row.peak_load_kw) ?? 0,
      ...(numberOf(row.household_size_used) === undefined
        ? {}
        : { householdSize: numberOf(row.household_size_used) as number }),
    };
  },
};
