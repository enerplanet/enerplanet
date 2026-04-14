import axios from "@/lib/axios";
import { normalizeFClass } from "@/features/configurator/utils/fClassUtils";

interface FClassOption {
  class: string;
  description: string;
}

interface BuildingEnergyEstimate {
  buildingType: string;
  fClass: string;
  area: number;
  householdSize?: number;
  estimatedHouseholds?: number;
  peakLoadKw: number;
  yearlyConsumptionKwh: number;
  source: "pylovo";
}

class EnergyService {
  private toOptionalFiniteNumber(value: unknown): number | undefined {
    if (value === null || value === undefined || value === "") return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  // Frontend stays dynamic: class labels come from pylovo f_class values.
  getFClassOptions(): FClassOption[] {
    return [
      {
        class: "dynamic",
        description: "Dynamic f_class profile from pylovo",
      },
    ];
  }

  private resolveDynamicClass(result: unknown, fallbackType: string): string {
    const asRecord =
      result && typeof result === "object" ? (result as Record<string, unknown>) : {};

    const candidates = [
      asRecord.f_class,
      asRecord.parsed_class,
      fallbackType,
    ];

    for (const candidate of candidates) {
      if (typeof candidate !== "string") continue;
      const normalized = normalizeFClass(candidate);
      if (normalized) return normalized;

      const lower = candidate.trim().toLowerCase();
      if (lower === "zd" || lower === "cd" || lower === "sp" || lower === "wf") {
        return lower;
      }
    }

    return "unknown";
  }

  async estimateBuildingEnergyDemand(
    buildingType: string,
    areaM2: number,
    householdSize?: number,
    yearOfConstruction?: number,
    numFloors?: number,
    energyLabel?: string,
    hotWaterElectric?: boolean
  ): Promise<BuildingEnergyEstimate> {
    try {
      const response = await axios.post<{ data: unknown }>("/v2/pylovo/estimate-energy", {
        building_type: buildingType,
        area_m2: areaM2,
        year_of_construction: this.toOptionalFiniteNumber(yearOfConstruction) ?? null,
        household_size: householdSize,
        num_floors: this.toOptionalFiniteNumber(numFloors) ?? null,
        energy_label: energyLabel ?? null,
        hot_water_electric: hotWaterElectric ?? false,
      });

      let result: unknown = response.data.data;
      if (
        result &&
        typeof result === "object" &&
        "data" in result &&
        "status" in result &&
        (result as Record<string, unknown>).status === "success"
      ) {
        result = (result as Record<string, unknown>).data;
      }

      const row = (result ?? {}) as Record<string, unknown>;
      const fClass = this.resolveDynamicClass(row, buildingType);

      return {
        buildingType,
        fClass,
        area: areaM2,
        householdSize: this.toOptionalFiniteNumber(row.household_size_used ?? householdSize),
        estimatedHouseholds: this.toOptionalFiniteNumber(row.estimated_households_used),
        peakLoadKw: Number(row.peak_load_kw ?? 0),
        yearlyConsumptionKwh: Number(row.yearly_demand_kwh ?? 0),
        source: "pylovo",
      };
    } catch (error) {
      console.error("AI estimation failed:", error);
      throw error;
    }
  }

  async estimateBuildingsEnergyDemand(
    buildings: Array<{
      id: string | number;
      type: string;
      area: number;
      householdSize?: number;
      yearOfConstruction?: number;
    }>
  ): Promise<Map<string | number, BuildingEnergyEstimate>> {
    const results = new Map<string | number, BuildingEnergyEstimate>();

    try {
      const batchPayload = {
        buildings: buildings.map((b) => ({
          building_type: b.type,
          area_m2: b.area,
          year_of_construction: this.toOptionalFiniteNumber(b.yearOfConstruction) ?? null,
          household_size: b.householdSize,
        })),
      };

      const response = await axios.post<{ data: unknown }>(
        "/v2/pylovo/estimate-energy-batch",
        batchPayload
      );

      let batchResults: unknown = response.data.data;
      if (
        batchResults &&
        typeof batchResults === "object" &&
        "data" in batchResults &&
        "status" in batchResults &&
        (batchResults as Record<string, unknown>).status === "success"
      ) {
        batchResults = (batchResults as Record<string, unknown>).data;
      }

      const rows = Array.isArray(batchResults) ? batchResults : [];

      for (let i = 0; i < buildings.length; i += 1) {
        const building = buildings[i];
        const row = rows[i] as Record<string, unknown> | undefined;

        if (!row || row.source === "error") {
          continue;
        }

        const fClass = this.resolveDynamicClass(row, building.type);
        results.set(building.id, {
          buildingType: building.type,
          fClass,
          area: building.area,
          householdSize: this.toOptionalFiniteNumber(
            row.household_size_used ?? building.householdSize
          ),
          estimatedHouseholds: this.toOptionalFiniteNumber(row.estimated_households_used),
          peakLoadKw: Number(row.peak_load_kw ?? 0),
          yearlyConsumptionKwh: Number(row.yearly_demand_kwh ?? 0),
          source: "pylovo",
        });
      }
    } catch (error) {
      console.error("Batch AI estimation failed:", error);
    }

    return results;
  }
}

const energyService = new EnergyService();
export default energyService;
