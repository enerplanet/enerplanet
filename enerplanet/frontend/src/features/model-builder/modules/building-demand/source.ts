/** The demand-estimate slot — what `building-demand` needs from a host, and nothing more. */

/** The per-building attributes the estimate is computed from — the pylovo feature properties. */
export interface BuildingAttributes {
  /** The building class the service resolves a profile from (`building_type` on the wire). */
  buildingType: string;
  /** Conditioned floor area, m². Without it there is nothing to estimate. */
  areaM2: number;
  yearOfConstruction?: number;
  householdSize?: number;
  numFloors?: number;
  energyLabel?: string;
}

/** What the service answers for one building. */
export interface DemandEstimate {
  /** The class the service actually used, which may differ from what was asked for. */
  fClass: string;
  /** Annual demand, kWh. */
  yearlyKwh: number;
  /** Peak load, kW. */
  peakKw: number;
  /** The household size the service used, when it resolved one. */
  householdSize?: number;
}

/** What a host must provide for this module to work. */
export interface DemandEstimateSource {
  estimate(attributes: BuildingAttributes): Promise<DemandEstimate>;
}

let source: DemandEstimateSource | null = null;

/** Install the source. The frame calls this at startup, the way it installs the grid engine. */
export function setDemandSource(next: DemandEstimateSource | null): void {
  source = next;
}

/** The installed source, or null when no host has provided one. */
export function demandSource(): DemandEstimateSource | null {
  return source;
}
