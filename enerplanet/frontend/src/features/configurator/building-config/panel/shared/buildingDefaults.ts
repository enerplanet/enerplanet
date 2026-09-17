// Default seed data and shared type definitions for the building configurator.
// These values are placeholders until real building data is loaded from the API.

import type { BuildingElement } from '@/features/configurator/building-config/panel/configure/model/buildingElements';

// ─── Technology types ─────────────────────────────────────────────────────────

/**
 * Configuration for a PV system. Field names match the EnerPlanET topology
 * `techs.pv_supply` object so they can be forwarded directly to the parent app.
 */
export interface PvConfig {
  /** Whether the system is included in the model. */
  installed: boolean;
  /**
   * Controls where tilt and azimuth come from.
   * 'surface' = inherit from the host building element; 'manual' = use the values below.
   */
  geometryMode: 'surface' | 'manual';
  /** Nameplate rated capacity (kWp). */
  system_capacity: number;
  /** Panel tilt from horizontal (deg). */
  tilt: number;
  /** Panel compass azimuth — 0 = North, 180 = South (deg). */
  azimuth: number;
  /** Maximum installable capacity (kWp). */
  cont_energy_cap_max: number;
  /** Minimum installable capacity (kWp). */
  cont_energy_cap_min: number;
  /** Combined panel + wiring efficiency (0–1). */
  cont_energy_eff: number;
  /** DC-to-AC inverter efficiency (0–1). */
  inv_eff: number;
  /** DC rated capacity / AC inverter rating. */
  dc_ac_ratio: number;
  /** Total system losses fraction (0–1). */
  losses: number;
  /** Expected system lifetime (years). */
  cont_lifetime: number;
  /** Capital cost per kWp (€/kWp). */
  cost_energy_cap: number;
  /** Annual operation and maintenance cost per kWp (€/kWp/year). */
  cost_om_annual: number;
  /** Discount rate for financial calculations (0–1). */
  cost_interest_rate: number;
  /** Whether the optimiser should auto-orient panels. */
  optimize_orientation: boolean;
  /**
   * Fraction of the host surface area that can realistically be covered by panels (%).
   * Accounts for obstructions (vents, chimneys, skylights), structural exclusions, and
   * required edge clearances. UI-only — used to derive cont_energy_cap_max.
   */
  usable_area_pct: number;
}

export const DEFAULT_PV_CONFIG: PvConfig = {
  installed:            false,
  geometryMode:         'surface',
  system_capacity:      8,
  tilt:                 35,
  azimuth:              180,
  cont_energy_cap_max:  8,
  cont_energy_cap_min:  0,
  cont_energy_eff:      0.9,
  inv_eff:              0.96,
  dc_ac_ratio:          1.1,
  losses:               0.14,
  cont_lifetime:        25,
  cost_energy_cap:      575,
  cost_om_annual:       8,
  cost_interest_rate:   0.02,
  optimize_orientation: false,
  usable_area_pct:      80,
};

/**
 * Returns a per-surface PV configuration seeded from the host surface geometry.
 * This avoids repeating the same PV defaults across overview and configure flows.
 */
export function createSurfacePvConfig(
  element?: Pick<BuildingElement, 'tilt' | 'azimuth'> | null,
): PvConfig {
  return {
    ...DEFAULT_PV_CONFIG,
    tilt: element?.tilt ?? DEFAULT_PV_CONFIG.tilt,
    azimuth: element?.azimuth ?? DEFAULT_PV_CONFIG.azimuth,
  };
}

// ─── Battery storage type ─────────────────────────────────────────────────────

/**
 * Configuration for a battery storage system.
 * Field names match the EnerPlanET topology `techs.battery_storage` object.
 */
export interface BatteryConfig {
  /** Whether the system is included in the model. */
  installed: boolean;
  /** Maximum charge/discharge power capacity (kW). */
  cont_energy_cap_max: number;
  /** Minimum charge/discharge power capacity (kW). */
  cont_energy_cap_min: number;
  /** Maximum storage capacity (kWh). */
  cont_storage_cap_max: number;
  /** Minimum storage capacity (kWh). */
  cont_storage_cap_min: number;
  /** One-way charge/discharge efficiency (0–1). Round-trip = eff². */
  cont_energy_eff: number;
  /** Hourly self-discharge rate as a fraction of stored energy (0–1). */
  cont_storage_loss: number;
  /** Minimum state of charge — 0 means fully dischargeable (0–1). */
  cont_storage_discharge_depth: number;
  /** Initial state of charge at start of simulation (0–1). */
  cont_storage_initial: number;
  /** Expected system lifetime (years). */
  cont_lifetime: number;
  /** Capital cost per kW of power capacity (€/kW). */
  cost_energy_cap: number;
  /** Capital cost per kWh of storage capacity (€/kWh). */
  cost_storage_cap: number;
  /** Annual operation and maintenance cost per kW (€/kW/year). */
  cost_om_annual: number;
  /** Discount rate for financial calculations (0–1). */
  cost_interest_rate: number;
}

export const DEFAULT_BATTERY_CONFIG: BatteryConfig = {
  installed:                    false,
  cont_energy_cap_max:          10,
  cont_energy_cap_min:          0,
  cont_storage_cap_max:         20,
  cont_storage_cap_min:         0,
  cont_energy_eff:              0.97,
  cont_storage_loss:            0,
  cont_storage_discharge_depth: 0,
  cont_storage_initial:         0,
  cont_lifetime:                11,
  cost_energy_cap:              1028,
  cost_storage_cap:             1007.93,
  cost_om_annual:               25.19,
  cost_interest_rate:           0.02,
};

// TODO:
export const DEFAULT_ELEMENTS: Record<string, BuildingElement> = {
  south_wall:     { id: 'south_wall',     label: 'South Wall',     type: 'wall',   area: 56.0, uValue: 0.24, gValue: null, tilt: 90, azimuth: 180, source: 'default', customMode: false },
  east_wall:      { id: 'east_wall',      label: 'East Wall',      type: 'wall',   area: 37.8, uValue: 0.24, gValue: null, tilt: 90, azimuth: 90,  source: 'default', customMode: false },
  north_wall:     { id: 'north_wall',     label: 'North Wall',     type: 'wall',   area: 56.0, uValue: 0.24, gValue: null, tilt: 90, azimuth: 0,   source: 'default', customMode: false },
  west_wall:      { id: 'west_wall',      label: 'West Wall',      type: 'wall',   area: 37.8, uValue: 0.24, gValue: null, tilt: 90, azimuth: 270, source: 'default', customMode: false },
  roof:           { id: 'roof',           label: 'Roof',           type: 'roof',   area: 98.0, uValue: 0.18, gValue: null, tilt: 35, azimuth: 180, source: 'default', customMode: false },
  floor:          { id: 'floor',          label: 'Ground Floor',   type: 'floor',  area: 90.0, uValue: 0.30, gValue: null, tilt: 0,  azimuth: 0,   source: 'default', customMode: false },
  south_window_1: { id: 'south_window_1', label: 'South Window 1', type: 'window', area: 4.5,  uValue: 1.30, gValue: 0.60, tilt: 90, azimuth: 180, source: 'default', customMode: false },
  south_window_2: { id: 'south_window_2', label: 'South Window 2', type: 'window', area: 4.5,  uValue: 1.30, gValue: 0.60, tilt: 90, azimuth: 180, source: 'default', customMode: false },
  east_window:    { id: 'east_window',    label: 'East Window',    type: 'window', area: 3.0,  uValue: 1.30, gValue: 0.60, tilt: 90, azimuth: 90,  source: 'default', customMode: false },
  door:           { id: 'door',           label: 'Front Door',     type: 'door',   area: 2.1,  uValue: 1.80, gValue: null, tilt: 90, azimuth: 180, source: 'default', customMode: false },
};

// TODO: These defaults are purely illustrative and should be replaced with real building data from the API.
export const DEFAULT_GENERAL = {
  buildingName:       '',
  buildingType:       'Multi-family House',
  constructionYear:   2015,
  country:            'DE',
  floorArea:          90.9, // per-storey footprint; 4 storeys ≈ 363.4 m² total
  roomHeight:         2.7,
  storeys:            4,
  n_air_infiltration: 0.4,
  n_air_use:          0.4,
  massClass:          'Medium',
  c_m:                110,
  use_milp:           false,
  electricityDemand:  4000,
  spaceHeatingDemand: 15000,
  dhwDemand:          2500,
  // TABULA neighbour code — sent to BuEM as neighbour_status.
  Code_AttachedNeighbours: 'B_Alone',
};

// ─── Floor area / volume ──────────────────────────────────────────────────────
// `floorArea` (general state) is the per-storey footprint, not the whole
// building's total — the total conditioned floor area (used for ignis's A_ref
// override, BuEM's A_ref, and any kWh/m²·a normalization) is always
// `floorArea × storeys`.

/** Total conditioned floor area (m²) across all storeys. */
export function computeTotalFloorArea(floorArea: number, storeys: number): number {
  return floorArea * Math.max(1, storeys);
}

/** Building volume (m³) from per-storey floor area, storeys, and room height. */
export function computeVolume(floorArea: number, storeys: number, roomHeight: number): number {
  return computeTotalFloorArea(floorArea, storeys) * roomHeight;
}

export const DEFAULT_TOTAL_AREA = Object.values(DEFAULT_ELEMENTS).reduce(
  (sum, el) => sum + el.area,
  0,
);

export const DEFAULT_AVG_U_VALUE = DEFAULT_TOTAL_AREA > 0
  ? Object.values(DEFAULT_ELEMENTS).reduce((sum, el) => sum + el.uValue * el.area, 0) / DEFAULT_TOTAL_AREA
  : 0;
