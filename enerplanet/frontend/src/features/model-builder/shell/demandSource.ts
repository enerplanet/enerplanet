/**
 * The demand-estimate source the frame installs: pylovo, through EnerPlanET's own backend.
 *
 * The module declares the slot (`modules/building-demand/source.ts`) and never learns which source it has.
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

    // The class the service *used* — normalised the same way the heat mirror normalises it.
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
