/**
 * The panel's only route to heat data.
 *
 * Every call goes to the EnerPlanET backend on the shared axios instance, so
 * one base URL and the session cookie cover all of it. The backend reaches
 * ignis, buem-gateway and weather-serve through the orchestrator; nothing here
 * knows those services exist or holds a credential for them.
 *
 * This replaces the standalone configurator's per-service browser clients.
 * Two consequences worth knowing:
 *
 *   - weather is resolved server-side from the building's own coordinates, so
 *     there is no weather call here and no provider to choose.
 *   - the ignis routes answer {success, data} around ignis's verbatim body, so
 *     each reader unwraps one level.
 *
 * Every function answers null (or an empty list) on failure rather than
 * throwing, so a panel that cannot reach one service still renders the rest.
 */

import axios from '@/lib/axios';

import type { BatteryConfig } from '../shared/buildingDefaults';
import type { BuildingIdentity } from './buemAdapter';
import { serializeToBuemFeature } from './buemAdapter';
import type {
  IgnisCalculateResponse,
  IgnisDataResponse,
  IgnisFieldMetadata,
  IgnisFieldMetadataResponse,
  IgnisInputs,
  IgnisMatchResponse,
  IgnisVariantLevel,
} from './ignisAdapter';
import { ignisInputsFromTabulaData, toIgnisApiPayload } from './ignisAdapter';
import type { LoadDataPoint } from './loadProfile';

/** Unwraps the backend's {success, data} envelope around a verbatim upstream body. */
function unwrap<T>(body: unknown): T {
  return (body as { data: T }).data;
}

// --- TABULA code mappings -------------------------------------------------

/** TABULA covers residential archetypes only, so anything else has no code. */
const BUILDING_TYPE_TO_TABULA: Record<string, string> = {
  'Single-family House': 'SFH',
  'Terraced House': 'TH',
  'Multi-family House': 'MFH',
  'Apartment Block': 'AB',
};

/** Converts a UI building type label to its TABULA code, or null if unsupported. */
export function toBuildingTypeCode(label: string): string | null {
  return BUILDING_TYPE_TO_TABULA[label] ?? null;
}

/** Reports whether TABULA covers this building type. */
export function isBuildingTypeSupported(label: string): boolean {
  return label in BUILDING_TYPE_TO_TABULA;
}

// --- ignis ----------------------------------------------------------------

/**
 * Lists the refurbishment variants for a building's country, type and
 * construction year. Answers null when TABULA does not cover the type, and on
 * any failure.
 */
export async function fetchMatchingVariants(
  countryIso2: string,
  buildingTypeLabel: string,
  constructionYear: number,
): Promise<IgnisMatchResponse | null> {
  const typeCode = toBuildingTypeCode(buildingTypeLabel);
  if (!typeCode) return null;

  try {
    const res = await axios.get(`/v2/ignis/variants/${encodeURIComponent(countryIso2)}/match`, {
      params: { type: typeCode, year: constructionYear },
    });
    return unwrap<IgnisMatchResponse>(res.data);
  } catch {
    return null;
  }
}

/** Fetches one variant's full TABULA record. */
export async function fetchVariantData(variantCode: string): Promise<IgnisDataResponse | null> {
  try {
    const res = await axios.get(`/v2/ignis/data/${encodeURIComponent(variantCode)}`);
    return unwrap<IgnisDataResponse>(res.data);
  } catch {
    return null;
  }
}

/**
 * Loads every refurbishment level for a building classification: the matching
 * variant codes, then each one's TABULA record. Answers an empty list when
 * nothing matches.
 */
export async function loadVariantLevels(
  countryIso2: string,
  buildingTypeLabel: string,
  constructionYear: number,
): Promise<IgnisVariantLevel[]> {
  const matchRes = await fetchMatchingVariants(countryIso2, buildingTypeLabel, constructionYear);
  if (!matchRes || matchRes.data.length === 0) return [];

  const levels: IgnisVariantLevel[] = [];
  await Promise.all(
    matchRes.data.map(async (entry) => {
      const dataRes = await fetchVariantData(entry.code);
      if (!dataRes) return;
      const inputs: IgnisInputs = ignisInputsFromTabulaData(
        dataRes.tabula_data as Record<string, unknown>,
      );
      levels.push({ code: entry.code, label: entry.label, data: inputs });
    }),
  );

  // Promise.all resolves out of order; the match order is the refurbishment
  // order, existing state first, and the selector depends on it.
  return matchRes.data
    .map((entry) => levels.find((l) => l.code === entry.code))
    .filter((l): l is IgnisVariantLevel => l !== undefined);
}

/**
 * Fetches the TABULA input-field catalogue used to label and describe the
 * form's inputs. Answers an empty list so a caller falls back to its own text.
 */
export async function fetchFieldMetadata(): Promise<IgnisFieldMetadata[]> {
  try {
    const res = await axios.get('/v2/ignis/fields');
    return unwrap<IgnisFieldMetadataResponse>(res.data).data ?? [];
  } catch {
    return [];
  }
}

/** Recalculates a variant's annual demand with the caller's TABULA overrides. */
export async function calculateHeatDemand(
  variantCode: string,
  calcDemand: IgnisInputs,
): Promise<IgnisCalculateResponse | null> {
  try {
    const res = await axios.post(
      `/v2/ignis/calculate/${encodeURIComponent(variantCode)}`,
      toIgnisApiPayload(calcDemand) ?? {},
    );
    return unwrap<IgnisCalculateResponse>(res.data);
  } catch {
    return null;
  }
}

// --- BuEM -----------------------------------------------------------------

/** A {value, unit} measurement, as buem-gateway shapes every figure. */
interface BuemQuantity {
  value: number;
  unit: string;
}

interface BuemThermalLoadProfile {
  summary: {
    heating: { total: BuemQuantity };
    cooling?: { total: BuemQuantity };
    electricity: { total: BuemQuantity };
    // v6-draft; absent on results predating hot_water/kitchen. Kitchen's total
    // is in kWh_gas, a fuel channel rather than electric kWh.
    hot_water?: { total: BuemQuantity };
    kitchen?: { total: BuemQuantity };
    // heating + cooling + electricity + hot_water, excluding kitchen.
    total_energy_demand?: BuemQuantity;
    peak_heating_load?: BuemQuantity;
    peak_cooling_load?: BuemQuantity;
    energy_intensity?: BuemQuantity;
  };
  timeseries?: {
    unit: string;
    kitchen_unit?: string;
    timestamps: string[];
    heating: number[];
    cooling?: number[];
    electricity: number[];
    hot_water?: number[];
    kitchen?: number[];
  };
}

export interface BuemThermalSummary {
  heatingKwh: number;
  coolingKwh: number;
  electricityKwh: number;
  peakHeatingKw: number;
  peakCoolingKw: number;
  energyIntensityKwhM2: number;
  dhwKwh: number;
  kitchenGasKwh: number;
  /** BuEM's own heating+cooling+electricity+hot_water total; gas excluded. */
  totalEnergyKwh: number;
}

export interface BuemSimulationResult {
  timeseries: LoadDataPoint[];
  thermalSummary: BuemThermalSummary;
}

/**
 * Runs BuEM for the building as currently edited and converts the result into
 * the panel's shapes.
 *
 * The envelope travels with the request, so a building whose surfaces the user
 * has corrected, or one City2TABULA has not linked, still runs. A real physics
 * solve takes seconds rather than milliseconds.
 */
export async function runBuildingSimulation(
  identity: BuildingIdentity,
  elements: Record<string, unknown>,
  general: Record<string, unknown>,
  modelId: string,
  batteryConfig?: BatteryConfig,
): Promise<BuemSimulationResult | null> {
  const feature = serializeToBuemFeature(
    identity,
    elements,
    general,
    undefined,
    undefined,
    undefined,
    undefined,
    batteryConfig,
  );

  try {
    const res = await axios.post('/v1/buem/building', {
      osm_id: feature.id,
      geometry: feature.geometry,
      building: feature.properties.buem.building,
      start_date: feature.properties.start_time,
      end_date: feature.properties.end_time,
      resolution: Number(feature.properties.resolution),
      model_id: modelId,
    });
    return toSimulationResult(
      (res.data as { buem: { thermal_load_profile: BuemThermalLoadProfile } }).buem
        .thermal_load_profile,
    );
  } catch {
    return null;
  }
}

function toSimulationResult(profile: BuemThermalLoadProfile): BuemSimulationResult {
  const ts = profile.timeseries;
  const timeseries: LoadDataPoint[] = ts
    ? ts.timestamps.map((timestamp, i) => ({
        timestamp,
        heating: ts.heating[i] ?? 0,
        electricity: ts.electricity[i] ?? 0,
        // LoadDataPoint has no cooling field; "hotwater" carries cooling, as
        // the thermalSummary fallback in BuildingConfigurator already assumes.
        // BuEM reports cooling negative, sharing one signed Q_HC axis, so the
        // sign flips here and every reader downstream sees a positive figure.
        hotwater: -(ts.cooling?.[i] ?? 0),
        dhw: ts.hot_water?.[i] ?? 0,
        kitchen: ts.kitchen?.[i] ?? 0,
      }))
    : [];

  return {
    timeseries,
    thermalSummary: {
      heatingKwh: profile.summary.heating.total.value,
      coolingKwh: profile.summary.cooling?.total.value ?? 0,
      electricityKwh: profile.summary.electricity.total.value,
      peakHeatingKw: profile.summary.peak_heating_load?.value ?? 0,
      peakCoolingKw: profile.summary.peak_cooling_load?.value ?? 0,
      energyIntensityKwhM2: profile.summary.energy_intensity?.value ?? 0,
      dhwKwh: profile.summary.hot_water?.total.value ?? 0,
      kitchenGasKwh: profile.summary.kitchen?.total.value ?? 0,
      totalEnergyKwh: profile.summary.total_energy_demand?.value ?? 0,
    },
  };
}

// --- City2TABULA ----------------------------------------------------------

/** One building's City2TABULA envelope, as the backend's enrich route returns it. */
export interface EnrichEntry {
  object_id: string;
  match_type: number;
  tabula_variant_code?: string;
  default_construction_year?: number;
  buem: {
    building: {
      n_storeys?: number;
      h_room?: { value: number; unit: string };
      footprint_area?: { value: number; unit: string };
      envelope: { elements: unknown[] };
    };
  };
}

/** The area a set of osm_ids sits in. City2TABULA selects its data by region. */
export interface EnrichBbox {
  xmin: number;
  ymin: number;
  xmax: number;
  ymax: number;
}

/**
 * Resolves City2TABULA envelopes for a set of osm_ids, keyed by osm_id.
 *
 * The country is deliberately not sent: the backend works it out from the bbox
 * centre with the same resolver a model run uses, so both name a building's
 * country identically and the panel never has to hold a canonical spelling.
 *
 * Answers an empty map on failure and while a region's 3D import is still
 * running, so a caller falls back to defaults rather than waiting. Unlike the
 * ignis routes this one answers its body directly, with no success envelope.
 */
export async function fetchEnvelopes(
  bbox: EnrichBbox,
  osmIds: string[],
): Promise<Record<string, EnrichEntry>> {
  if (osmIds.length === 0) return {};
  try {
    const res = await axios.post('/v1/city2tabula/enrich', { bbox, osm_ids: osmIds });
    return (res.data as { data?: Record<string, EnrichEntry> }).data ?? {};
  } catch {
    return {};
  }
}
