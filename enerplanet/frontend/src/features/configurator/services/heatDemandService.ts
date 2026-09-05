import axios from "@/lib/axios";

export interface HeatDemandResolveRequest {
  osm_id: string;
  f_class: string;
  building_type?: string;
  construction_year?: number;
  floor_area_m2: number;
  country?: string;
}

export type HeatDemandSource = "buem" | "ignis" | "estimate";

export interface HeatDemandResolveResponse {
  osm_id: string;
  source: HeatDemandSource;
  heating_demand_kwh_a: number;
  specific_heating_demand_kwh_m2a: number;
  tabula_variant_code: string | null;
  hourly_profile: unknown | null;
  inputs_echoed: {
    f_class: string;
    building_type?: string;
    construction_year?: number;
    floor_area_m2: number;
    country?: string;
  };
  warnings: string[];
}

export interface IgnisFieldMetadata {
  key: string;
  group: string;
  path: string;
  unit?: string;
  label: string;
  simple_description: string;
  expert_description: string;
}

// The ignis proxy (internal/handler/ignis) wraps every forwarded response in
// {success, data}; ignis's own handlers each nest their payload under its own
// "data" key, hence the double nesting here.
interface IgnisProxyEnvelope<T> {
  success: boolean;
  data: T;
}

// The resolve endpoint's `country` is the canonical name geo.NormalizeCountry
// produces on the backend (e.g. "germany"), not an ISO2 code; countryCode on a
// building is ISO2 (e.g. "DE"). Mirrors internal/ignis's isoByCountry, inverted.
const COUNTRY_NAME_BY_ISO2: Record<string, string> = {
  DE: "germany", FR: "france", AT: "austria", CH: "switzerland",
  NL: "netherlands", BE: "belgium", PL: "poland", SE: "sweden",
  NO: "norway", FI: "finland", DK: "denmark", IE: "ireland",
  CZ: "czechia", RO: "romania", HU: "hungary", GR: "greece",
  HR: "croatia", BG: "bulgaria", SK: "slovakia", SI: "slovenia",
  LU: "luxembourg", EE: "estonia", LV: "latvia", LT: "lithuania",
  ES: "spain", IT: "italy", PT: "portugal", GB: "uk",
};

export function countryNameForIso2(iso2: string | undefined): string | undefined {
  if (!iso2) return undefined;
  return COUNTRY_NAME_BY_ISO2[iso2.toUpperCase()];
}

export const heatDemandService = {
  resolve: async (payload: HeatDemandResolveRequest): Promise<HeatDemandResolveResponse> => {
    const response = await axios.post<HeatDemandResolveResponse>("/v1/heat-demand/resolve", payload);
    return response.data;
  },

  // Static, country-independent field metadata (label/unit/hint) for form fields
  // that overlap an ignis TABULA input - in the simple form, only floor area.
  getFields: async (): Promise<IgnisFieldMetadata[]> => {
    const response = await axios.get<IgnisProxyEnvelope<{ data: IgnisFieldMetadata[] }>>("/v2/ignis/fields");
    return response.data.data.data;
  },

  // The country's real TABULA building types, derived from its variant codes
  // (CC.N.TYPE.PERIOD.Suffix) rather than a fixed enum - not every country has
  // every type.
  getBuildingTypes: async (countryIso2: string): Promise<string[]> => {
    const response = await axios.get<IgnisProxyEnvelope<{ country: string; data: string[] }>>(
      `/v2/ignis/variants/${encodeURIComponent(countryIso2)}`
    );
    return buildingTypesFromVariantCodes(response.data.data.data ?? []);
  },
};

/** The distinct TABULA type (3rd dotted segment) across a list of variant codes. */
export function buildingTypesFromVariantCodes(codes: string[]): string[] {
  const types = new Set<string>();
  for (const code of codes) {
    const type = code.split(".")[2];
    if (type) types.add(type);
  }
  return Array.from(types).sort();
}
