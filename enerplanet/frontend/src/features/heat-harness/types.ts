// ---------------------------------------------------------------------------
// Heat Harness — types
// TEMPORARY harness for the heat-network plan (§1–§6). Not final API shapes.
// ---------------------------------------------------------------------------

/** Auto-resolve mode, per heat-network-plan.md §3. */
export type HeatResolutionMode = 'simple' | 'expected' | 'manual';

/** A heat-capable technology as served by the OpenTech-DB proxy. */
export interface OtdbHeatTech {
  id: string;            // UUID (detail endpoint takes UUID, not slug)
  slug: string;
  name: string;
  category: string;
  input_carriers: string[];
  output_carriers: string[];
  /** Default instance (instances[0]) — label + key params, loaded lazily. */
  instance?: {
    label: string;
    capacity_kw?: number;
    capex_per_kw?: number;
    efficiency?: number;
    fuel_cost_per_mwh?: number;
  };
}

/** One building in the harness workspace. */
export interface HarnessBuilding {
  id: string;            // locally generated (b1, b2, ...)
  label: string;         // e.g. "Apartment complex"
  fClass: string;        // normalized f-class key
  areaSqm: number;
  /** Explicit yearly heat demand (kWh/yr). 0/undefined → estimated from area. */
  explicitDemandKwh?: number;
  /** Assigned heat tech slug; '' = none. */
  techSlug: string;
  /** '' = none; otherwise id of a producer building feeding this one. */
  supplierId: string;
  /** True when the tech was auto-assigned (not user-picked). */
  estimated: boolean;
}

/** Computed view of a building (derived in the page). */
export interface BuildingView extends HarnessBuilding {
  demandKwh: number;          // resolved yearly heat demand
  hasOwnTech: boolean;
  isProducer: boolean;        // own tech with heat output
  suppliedById: string | null;
  resolved: boolean;          // own tech OR supplied by a producer building
}

/** What the harness would send downstream (config contract preview). */
export interface HarnessPayload {
  energyVectors: string[];
  heatResolutionMode: HeatResolutionMode;
  buildings: {
    id: string;
    fClass: string;
    area_sqm: number;
    demand_heat_kwh: number;
    tech: string | null;
    estimated: boolean;
  }[];
  heatLinks: {
    from: string;
    to: string;
  }[];
}