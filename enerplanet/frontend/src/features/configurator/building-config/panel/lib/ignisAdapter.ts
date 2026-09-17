/**
 * ignis data model and adapter functions.
 *
 * ignis uses ISO 13790 / TABULA building-level scalar inputs — one value per
 * element type across the whole building — whereas BuEM uses per-surface arrays.
 * This module defines the ignis state shape, derives aggregate ignis inputs from
 * BuEM surface data, and produces the payload sent to the ignis API.
 *
 * The ignis state lives alongside BuEM state in BuildingState; neither overwrites
 * the other. Shared fields (floor area, infiltration rates, thermal mass, etc.)
 * are kept in sync by BuildingConfigurator.
 */

import type { BuildingElement } from '@/features/configurator/building-config/panel/configure/model/buildingElements';
import type { BuildingState } from './buemAdapter';

// ─── ignis scalar input types ──────────────────────────────────────────────────

/**
 * TABULA building-level scalar inputs sent to the ignis pipeline.
 * All fields are optional so partial objects can be merged progressively
 * (TABULA DB defaults → BuEM-derived values → user overrides).
 */
export interface IgnisInputs {
  // Reference floor area (m²) — synced with BuEM floorArea
  A_C_Ref_Input?: number;

  // Envelope areas (m²) — aggregated from BuEM surface elements
  A_Roof_1?: number;
  A_Roof_2?: number;
  A_Wall_1?: number;
  A_Wall_2?: number;
  A_Wall_3?: number;
  A_Floor_1?: number;
  A_Floor_2?: number;
  A_Window_1?: number;
  A_Window_2?: number;
  A_Window_South?: number;
  A_Window_East?: number;
  A_Window_West?: number;
  A_Window_North?: number;
  A_Door_1?: number;

  // Climate conditions
  HeatingDays?: number;
  Theta_e?: number;   // external design temperature (°C)
  Theta_i?: number;   // internal design temperature (°C)

  // U-values (W/m²K) — area-weighted average by element type from BuEM surfaces
  U_Roof_1?: number;
  U_Wall_1?: number;
  U_Floor_1?: number;
  U_Window_1?: number;
  U_Door_1?: number;

  // Shared with BuEM — kept in sync
  N_air_infiltration?: number;
  N_air_use?: number;
  F_sh_hor?: number;
  F_sh_vert?: number;
  F_f?: number;
  F_w?: number;
  C_m?: number;
  Phi_int?: number;

  // Solar irradiance (Wh/m²·a) — from climate dataset, not BuEM
  I_Sol_South?: number;
  I_Sol_East?: number;
  I_Sol_West?: number;
  I_Sol_North?: number;
  I_Sol_Horizontal?: number;

  // Thermal bridging (W/m²K) — added to U-values
  Delta_U_ThermalBridging_Original?: number;
  Delta_U_ThermalBridging_Refurbished?: number;
}

// ─── Refurbishment level ──────────────────────────────────────────────────────

/**
 * One pre-defined refurbishment level loaded from the TABULA DB.
 * The data object is read-only — user edits go into IgnisState.calcDemand.
 */
export interface IgnisVariantLevel {
  /** Full TABULA variant code, e.g. "DE.N.SFH.01.Gen". */
  code: string;
  /** Human-readable label: "Existing state" | "Medium refurbishment" | "Advanced refurbishment". */
  label: string;
  /** TABULA scalar values for this refurbishment level. Never mutated after load. */
  data: IgnisInputs;
}

// ─── ignis state ───────────────────────────────────────────────────────────────

/**
 * All ignis-related state for a single building.
 * Attached to BuildingState.hdcp; null until the user's building classification
 * resolves to at least one TABULA variant.
 */
export interface IgnisState {
  /** ISO 3166-1 alpha-2 country code, e.g. "DE". */
  countryIso2: string;
  /** TABULA building type code, e.g. "SFH", "MFH". */
  buildingTypeCode: string;
  /** TABULA construction period index, e.g. "01", "02". */
  constructionPeriod: string;

  /**
   * Pre-defined refurbishment levels from the TABULA DB, ordered from
   * existing state to most-refurbished. Never mutated after load.
   */
  variants: IgnisVariantLevel[];

  /** Index into variants[] for the currently selected refurbishment level. */
  selectedVariantIndex: number;

  /**
   * Working copy of the selected variant's data, augmented with values
   * derived from BuEM surfaces and any user edits.
   *
   * This is what gets sent to the ignis API. Reset to the selected
   * variant's data (plus BuEM-derived geometry) at any time.
   */
  calcDemand: IgnisInputs;

  /**
   * True when calcDemand differs from the selected variant's data.
   * Used to show the "Reset to defaults" button.
   */
  isDirty: boolean;

  /** Latest heat demand result from the ignis API, or null. */
  result: { qHnd: number; unit: 'kWh/(m2.a)' } | null;

  /** True while an ignis API call is in flight. */
  loading: boolean;

  /** Error message from the last failed ignis API call, or null. */
  error: string | null;
}

// ─── API response types ───────────────────────────────────────────────────────

/** Shape of one entry in the /variants/:country/match response. */
export interface IgnisVariantEntry {
  code: string;
  label: string;
}

/** Shape of /variants/:country/match response body. */
export interface IgnisMatchResponse {
  country: string;
  prefix: string;
  data: IgnisVariantEntry[];
}

/** Shape of /data/:code response body. */
export interface IgnisDataResponse {
  country: string;
  variant_code: string;
  tabula_data: Record<string, unknown>;
  expected_q_h_nd: number;
}

/** Shape of /calculate/:code response body. */
export interface IgnisCalculateResponse {
  variant_code: string;
  q_h_nd: number;
  unit: string;
}

/**
 * One entry from /api/v1/fields — a human-readable description of a TABULA
 * input field, generated by ignis from its own Go struct definitions.
 * Identical for every country. `key` matches the leaf key used by
 * `TABULA_FIELD_PATHS` below.
 */
export interface IgnisFieldMetadata {
  key: string;
  group: string;
  path: string;
  unit?: string;
  label: string;
  simple_description: string;
  expert_description: string;
}

/** Shape of /api/v1/fields response body. */
export interface IgnisFieldMetadataResponse {
  data: IgnisFieldMetadata[];
}

// ─── Derivation from BuEM surfaces ───────────────────────────────────────────

/** Azimuth bucket boundaries for cardinal direction area aggregation. */
function cardinalFromAzimuth(azimuth: number): 'South' | 'East' | 'West' | 'North' {
  const a = ((azimuth % 360) + 360) % 360; // normalise to [0, 360)
  if (a >= 45 && a < 135) return 'East';
  if (a >= 135 && a < 225) return 'South';
  if (a >= 225 && a < 315) return 'West';
  return 'North';
}

/**
 * Derives ignis aggregate inputs from BuEM surface-level data.
 * Called when a TABULA variant is first loaded to pre-fill geometry fields.
 *
 * Returns a partial IgnisInputs — only the fields that can be computed from
 * BuEM surfaces. Climate, solar, and thermal-bridging fields are left for
 * the TABULA DB record to supply.
 */
export function deriveIgnisInputsFromBuem(building: BuildingState): Partial<IgnisInputs> {
  const elements = Object.values(building.envelope) as BuildingElement[];

  const derived: Partial<IgnisInputs> = {};

  // ── Envelope areas and area-weighted U-values by element type ──────────────

  const byType = (type: BuildingElement['type']) => elements.filter(e => e.type === type);

  const sumArea = (els: BuildingElement[]) => els.reduce((s, e) => s + (e.area ?? 0), 0);

  const weightedUValue = (els: BuildingElement[]): number | undefined => {
    const totalArea = sumArea(els);
    if (totalArea === 0) return undefined;
    const weighted = els.reduce((s, e) => s + (e.uValue ?? 0) * (e.area ?? 0), 0);
    return weighted / totalArea;
  };

  const roofs   = byType('roof');
  const walls   = byType('wall');
  const floors  = byType('floor');
  const windows = byType('window');
  const doors   = byType('door');

  if (roofs.length   > 0) { derived.A_Roof_1   = sumArea(roofs);   derived.U_Roof_1   = weightedUValue(roofs); }
  if (walls.length   > 0) { derived.A_Wall_1   = sumArea(walls);   derived.U_Wall_1   = weightedUValue(walls); }
  if (floors.length  > 0) { derived.A_Floor_1  = sumArea(floors);  derived.U_Floor_1  = weightedUValue(floors); }
  if (windows.length > 0) { derived.A_Window_1 = sumArea(windows); derived.U_Window_1 = weightedUValue(windows); }
  if (doors.length   > 0) { derived.A_Door_1   = sumArea(doors);   derived.U_Door_1   = weightedUValue(doors); }

  // ── Window areas by cardinal direction ─────────────────────────────────────

  const windowsByDir: Record<string, number> = { South: 0, East: 0, West: 0, North: 0 };
  for (const w of windows) {
    const dir = cardinalFromAzimuth(w.azimuth ?? 180);
    windowsByDir[dir] += w.area ?? 0;
  }
  if (windowsByDir.South > 0) derived.A_Window_South = windowsByDir.South;
  if (windowsByDir.East  > 0) derived.A_Window_East  = windowsByDir.East;
  if (windowsByDir.West  > 0) derived.A_Window_West  = windowsByDir.West;
  if (windowsByDir.North > 0) derived.A_Window_North = windowsByDir.North;

  // ── Reference floor area — from building identity ─────────────────────────

  if (building.identity.floorArea > 0) {
    derived.A_C_Ref_Input = building.identity.floorArea;
  }

  return derived;
}

/** Per-category TABULA U-value field for each BuEM surface element type. */
const TABULA_UVALUE_FIELD_BY_TYPE: Record<BuildingElement['type'], keyof IgnisInputs> = {
  roof:   'U_Roof_1',
  wall:   'U_Wall_1',
  floor:  'U_Floor_1',
  window: 'U_Window_1',
  door:   'U_Door_1',
};

/**
 * Applies a refurbishment level's per-category TABULA U-values onto every
 * matching BuEM surface element (by type — roof/wall/floor/window/door).
 *
 * This is the reverse direction of deriveIgnisInputsFromBuem: without it,
 * BuEM's real per-surface U-values always win, so selecting a different
 * refurbishment level cannot change the modelled insulation — thermal
 * efficiency and the heat-demand calculation would stay frozen at whatever
 * the building's original surfaces were, regardless of level chosen.
 * Returns the same object reference if nothing actually changed.
 */
export function applyTabulaUValuesToElements(
  elements: Record<string, BuildingElement>,
  variantData: IgnisInputs,
): Record<string, BuildingElement> {
  let changed = false;
  const next: Record<string, BuildingElement> = {};

  for (const [id, el] of Object.entries(elements)) {
    const uValue = variantData[TABULA_UVALUE_FIELD_BY_TYPE[el.type]] as number | undefined;
    if (uValue !== undefined && uValue !== el.uValue) {
      next[id] = { ...el, uValue };
      changed = true;
    } else {
      next[id] = el;
    }
  }

  return changed ? next : elements;
}

/**
 * Rebases every element's `uValue` AND its stamped `defaultUValue` ("existing
 * state" baseline) onto the new building type/period/country's own TABULA
 * "existing state" archetype (variant index 0).
 *
 * Unlike applyTabulaUValuesToElements (a temporary refurbishment-level
 * preview that leaves defaultUValue untouched so "existing state" can be
 * restored later), this is a permanent rebase: switching building type is a
 * different building, so its own "existing state" TABULA values become the
 * new baseline, not just a preview layered on top of the previous type's
 * values. Returns the same object reference if nothing actually changed.
 */
export function resetElementsToVariantDefaults(
  elements: Record<string, BuildingElement>,
  existingStateData: IgnisInputs,
): Record<string, BuildingElement> {
  let changed = false;
  const next: Record<string, BuildingElement> = {};

  for (const [id, el] of Object.entries(elements)) {
    const uValue = existingStateData[TABULA_UVALUE_FIELD_BY_TYPE[el.type]] as number | undefined;
    if (uValue !== undefined && (uValue !== el.uValue || uValue !== el.defaultUValue)) {
      next[id] = { ...el, uValue, defaultUValue: uValue };
      changed = true;
    } else {
      next[id] = el;
    }
  }

  return changed ? next : elements;
}

/**
 * Restores every element's `uValue` to its stamped `defaultUValue` — the
 * real, as-measured/configured value from before any refurbishment-level
 * override. Used when the user switches back to "existing state."
 * Returns the same object reference if nothing actually changed.
 */
export function restoreDefaultUValues(
  elements: Record<string, BuildingElement>,
): Record<string, BuildingElement> {
  let changed = false;
  const next: Record<string, BuildingElement> = {};

  for (const [id, el] of Object.entries(elements)) {
    if (el.defaultUValue !== undefined && el.defaultUValue !== el.uValue) {
      next[id] = { ...el, uValue: el.defaultUValue };
      changed = true;
    } else {
      next[id] = el;
    }
  }

  return changed ? next : elements;
}

/**
 * Syncs surface U-values with the given refurbishment level: the real
 * (defaultUValue) values for "existing state" (index 0), or that level's
 * TABULA archetype U-values for any refurbished level.
 */
export function syncElementsWithVariantLevel(
  elements: Record<string, BuildingElement>,
  variantIndex: number,
  variantData: IgnisInputs,
): Record<string, BuildingElement> {
  return variantIndex === 0
    ? restoreDefaultUValues(elements)
    : applyTabulaUValuesToElements(elements, variantData);
}

// ─── TABULA data → IgnisInputs ─────────────────────────────────────────────────

/**
 * Dotted path from the root of a `GET /api/v1/data/:code` `tabula_data` object
 * down to one leaf field, e.g. "AdvancedParameters.ClimateConditions.HeatingDays".
 * Mirrors the nesting in ignis's `internal/models/tabula.go` — this schema is
 * identical for every TABULA country (one shared Excel header row generates every
 * country's table), so no per-country variant of this table is needed.
 */
const TABULA_FIELD_PATHS: Record<keyof IgnisInputs, string> = {
  A_C_Ref_Input:    'BasicParameters.Envelope.A_C_Ref_Input',
  A_Roof_1:         'BasicParameters.Envelope.A_Roof_1',
  A_Roof_2:         'BasicParameters.Envelope.A_Roof_2',
  A_Wall_1:         'BasicParameters.Envelope.A_Wall_1',
  A_Wall_2:         'BasicParameters.Envelope.A_Wall_2',
  A_Wall_3:         'BasicParameters.Envelope.A_Wall_3',
  A_Floor_1:        'BasicParameters.Envelope.A_Floor_1',
  A_Floor_2:        'BasicParameters.Envelope.A_Floor_2',
  A_Window_1:       'BasicParameters.Envelope.A_Window_1',
  A_Window_2:       'BasicParameters.Envelope.A_Window_2',
  A_Window_South:   'BasicParameters.Envelope.A_Window_South',
  A_Window_East:    'BasicParameters.Envelope.A_Window_East',
  A_Window_West:    'BasicParameters.Envelope.A_Window_West',
  A_Window_North:   'BasicParameters.Envelope.A_Window_North',
  A_Door_1:         'BasicParameters.Envelope.A_Door_1',
  HeatingDays:      'AdvancedParameters.ClimateConditions.HeatingDays',
  Theta_e:          'AdvancedParameters.ClimateConditions.Theta_e',
  Theta_i:          'AdvancedParameters.ClimateConditions.theta_i', // lowercase in TABULA/DB
  U_Roof_1:         'AdvancedParameters.Uvalues.U_Roof_1',
  U_Wall_1:         'AdvancedParameters.Uvalues.U_Wall_1',
  U_Floor_1:        'AdvancedParameters.Uvalues.U_Floor_1',
  U_Window_1:       'AdvancedParameters.Uvalues.U_Window_1',
  U_Door_1:         'AdvancedParameters.Uvalues.U_Door_1',
  N_air_infiltration: 'AdvancedParameters.AirInfiltration.n_air_infiltration',
  N_air_use:          'AdvancedParameters.AirInfiltration.n_air_use',
  F_sh_hor:           'AdvancedParameters.HeatTransfer.F_sh_hor',
  F_sh_vert:          'AdvancedParameters.HeatTransfer.F_sh_vert',
  F_f:                'AdvancedParameters.HeatTransfer.F_f',
  F_w:                'AdvancedParameters.HeatTransfer.F_w',
  C_m:                'AdvancedParameters.HeatTransfer.c_m',
  Phi_int:            'AdvancedParameters.HeatTransfer.phi_int',
  I_Sol_South:        'AdvancedParameters.SolarGains.I_Sol_South',
  I_Sol_East:         'AdvancedParameters.SolarGains.I_Sol_East',
  I_Sol_West:         'AdvancedParameters.SolarGains.I_Sol_West',
  I_Sol_North:        'AdvancedParameters.SolarGains.I_Sol_North',
  I_Sol_Horizontal:   'AdvancedParameters.SolarGains.I_Sol_Hor',
  Delta_U_ThermalBridging_Original:    'AdvancedParameters.ThermalBridges.delta_U_ThermalBridging_Original',
  Delta_U_ThermalBridging_Refurbished: 'AdvancedParameters.ThermalBridges.delta_U_ThermalBridging_Refurbished',
};

/**
 * Rounds away float32-to-float64 widening noise (e.g. 4.599999904632568 for 4.6).
 * ignis stores these TABULA columns as Postgres `REAL` (single precision) but
 * reads them into Go `float64`, so the extra digits are precision artifacts,
 * not real data — 4 decimal places keeps all meaningful precision for every
 * field here (areas, U-values, temperatures, thermal bridging deltas).
 */
function roundToStoredPrecision(value: number): number {
  return Math.round(value * 10000) / 10000;
}

/** Reads a numeric value from `root` by walking a dotted path; undefined if any segment is missing or not a number. */
function numAtPath(root: Record<string, unknown>, path: string): number | undefined {
  let current: unknown = root;
  for (const segment of path.split('.')) {
    if (typeof current !== 'object' || current === null) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return typeof current === 'number' ? roundToStoredPrecision(current) : undefined;
}

/**
 * Extracts ignis scalar inputs from the raw TABULA API data record
 * (the `tabula_data` object from `GET /api/v1/data/:code`).
 * Only the fields relevant to the UI are extracted; internal TABULA fields
 * (measure codes, plausibility thresholds, etc.) are left in the DB.
 */
export function ignisInputsFromTabulaData(tabula: Record<string, unknown>): IgnisInputs {
  const result: Partial<IgnisInputs> = {};
  for (const key of Object.keys(TABULA_FIELD_PATHS) as (keyof IgnisInputs)[]) {
    result[key] = numAtPath(tabula, TABULA_FIELD_PATHS[key]);
  }

  // Generic TABULA archetype rows (as opposed to a specific real building) carry
  // A_C_Ref_Input as 0/unset — the archetype's reference floor area lives in
  // A_C_Ref_Estim instead. Fall back to it so "existing state" defaults still
  // have a usable floor area.
  if (!result.A_C_Ref_Input) {
    result.A_C_Ref_Input = numAtPath(tabula, 'BasicParameters.Envelope.A_C_Ref_Estim');
  }

  return result as IgnisInputs;
}

// ─── API payload ──────────────────────────────────────────────────────────────

/**
 * Maps each overridable IgnisInputs field to its POST /calculate JSON key.
 *
 * A_ref is deliberately absent though ignis accepts it: overriding the
 * reference area while the archetype's envelope areas stay fixed scales
 * q_h_nd per m2 non-linearly (verified 13.22 -> 1.55 kWh/(m2.a) for A_ref
 * 150 -> 300). ignis returns the archetype's own per-m2 figure from an empty
 * body; callers that need an absolute total multiply by the real floor area
 * (resolveDisplayEnergyTotals in BuildingConfigurator.tsx).
 */
const IGNIS_OVERRIDE_FIELD_KEYS: [keyof IgnisInputs, string][] = [
  ['HeatingDays', 'HeatingDays'],
  ['Theta_e', 'Theta_e'],
  ['Theta_i', 'theta_i'],
  ['I_Sol_South', 'I_Sol_South'],
  ['I_Sol_East', 'I_Sol_East'],
  ['I_Sol_West', 'I_Sol_West'],
  ['I_Sol_North', 'I_Sol_North'],
  ['I_Sol_Horizontal', 'I_Sol_Hor'],
  ['Delta_U_ThermalBridging_Original', 'delta_U_ThermalBridging_Original'],
  ['Delta_U_ThermalBridging_Refurbished', 'delta_U_ThermalBridging_Refurbished'],
];

/**
 * Produces the request body for POST /api/v1/calculate/:code — the
 * climate/solar/thermal-bridging overrides (heating days, design
 * temperatures, solar irradiance, thermal bridging) are included when
 * present on calcDemand, so editing "Advanced parameters" actually changes
 * the returned q_h_nd. Returns undefined for an empty body so the caller
 * omits it and ignis uses the stored archetype values (see
 * IGNIS_OVERRIDE_FIELD_KEYS on why A_ref is not sent).
 */
export function toIgnisApiPayload(calcDemand: IgnisInputs): Record<string, unknown> | undefined {
  const payload: Record<string, unknown> = {};
  for (const [inputKey, jsonKey] of IGNIS_OVERRIDE_FIELD_KEYS) {
    const value = calcDemand[inputKey];
    if (value !== undefined) payload[jsonKey] = value;
  }
  return Object.keys(payload).length > 0 ? payload : undefined;
}

// ─── State initialiser ────────────────────────────────────────────────────────

/**
 * Builds the initial IgnisState after the variant match API call returns results.
 * Selects the first variant (existing state) and pre-fills geometry from BuEM data.
 */
export function initIgnisState(
  countryIso2: string,
  buildingTypeCode: string,
  constructionPeriod: string,
  variants: IgnisVariantLevel[],
  building: BuildingState,
): IgnisState {
  const buemDerived = deriveIgnisInputsFromBuem(building);
  const baseData = variants[0]?.data ?? {};

  // Merge: TABULA defaults first, BuEM geometry on top (geometry is more accurate)
  const calcDemand: IgnisInputs = { ...baseData, ...buemDerived };

  return {
    countryIso2,
    buildingTypeCode,
    constructionPeriod,
    variants,
    selectedVariantIndex: 0,
    calcDemand,
    isDirty: false,
    result: null,
    loading: false,
    error: null,
  };
}

/**
 * Returns updated IgnisState after the user switches refurbishment level.
 * Resets calcDemand to the new variant's data merged with the current BuEM geometry.
 */
export function selectVariantLevel(
  state: IgnisState,
  index: number,
  building: BuildingState,
): IgnisState {
  const variant = state.variants[index];
  if (!variant) return state;

  const buemDerived = deriveIgnisInputsFromBuem(building);
  const calcDemand: IgnisInputs = { ...variant.data, ...buemDerived };

  return { ...state, selectedVariantIndex: index, calcDemand, isDirty: false, result: null };
}

/**
 * Returns updated IgnisState after a field edit.
 * Merges the changed fields into calcDemand and marks the state as dirty.
 */
export function updateCalcDemand(state: IgnisState, changes: Partial<IgnisInputs>): IgnisState {
  return {
    ...state,
    calcDemand: { ...state.calcDemand, ...changes },
    isDirty: true,
  };
}

/**
 * Resets calcDemand to the selected variant's defaults merged with BuEM geometry.
 */
export function resetCalcDemand(state: IgnisState, building: BuildingState): IgnisState {
  const variant = state.variants[state.selectedVariantIndex];
  if (!variant) return state;

  const buemDerived = deriveIgnisInputsFromBuem(building);
  const calcDemand: IgnisInputs = { ...variant.data, ...buemDerived };

  return { ...state, calcDemand, isDirty: false, result: null };
}
