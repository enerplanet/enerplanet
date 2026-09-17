// Converts a raw BUEM GeoJSON Feature into the typed BuildingState the UI consumes.
//
// All JSON path traversal is centralised here. UI components receive BuildingState
// and never access raw BUEM JSON directly. The paths themselves are documented in
// src/app/config/modelDataMap.ts.

import { TECH_REGISTRY } from '../config/techRegistry';
import { MODEL_DATA_MAP } from '../config/modelDataMap';
import {
  getMappedArray,
  getMappedNumber,
  getMappedRecord,
  getMappedValue,
  hasMappedValue,
} from '../config/modelDataResolver';
import type { BuildingElement } from '@/features/configurator/building-config/panel/configure/model/buildingElements';
import type { LoadDataPoint } from './loadProfile';

// ─── Exported types ───────────────────────────────────────────────────────────

export interface BuildingIdentity {
  id: string;
  /** Human-readable display label, e.g. "Building 1". */
  label: string;
  /** [longitude, latitude] in decimal degrees. */
  coordinates: [number, number];
  buildingType: string;        // localised label, e.g. "Multi-family House"
  constructionYear: number;
  country: string;
  floorArea: number;           // m²
  roomHeight: number;          // m
  storeys: number;
}

export interface ThermalSummary {
  heatingKwh: number;
  coolingKwh: number;
  electricityKwh: number;
  peakHeatingKw: number;
  peakCoolingKw: number;
  energyIntensityKwhM2: number;
  /** Domestic hot water, kWh — absent (0) on results predating BuEM's v6-draft hot_water/kitchen fields. */
  dhwKwh: number;
  /** Cooking gas demand — a different fuel channel from the electric kWh above, kept in kWh_gas rather than summed with it. */
  kitchenGasKwh: number;
  /** BuEM's own heating+cooling+electricity+hot_water total — gas deliberately excluded. */
  totalEnergyKwh: number;
}

export interface GeometryData {
  buildingId: string;
  coordinates: [number, number];
  buildingFootprint: unknown | null;
  buildingHeight: number | null;
}

export interface ThematicData {
  identity: BuildingIdentity;
  envelope: Record<string, BuildingElement>;
  thermalSummary: ThermalSummary | null;
  timeseries: LoadDataPoint[] | null;
}

export type InstalledTechnologyId = keyof typeof MODEL_DATA_MAP.technologies.catalog;

export interface TechnologyData {
  rawTechs: Record<string, unknown>;
  installedTechIds: InstalledTechnologyId[];
}

export interface BuildingState {
  /** Centralised geometry domain for embedding this dashboard in external apps. */
  geometry: GeometryData;
  /** Centralised thematic domain for identity, envelope and results. */
  thematic: ThematicData;
  /** Centralised technology domain for installed tech discovery. */
  technologies: TechnologyData;
  identity: BuildingIdentity;
  /** Envelope surfaces keyed by element id — same shape as the configurator UI. */
  envelope: Record<string, BuildingElement>;
  /** Annual summary from the model. Null when no results are present. */
  thermalSummary: ThermalSummary | null;
  /** Hourly load profile. Null when the request did not include timeseries. */
  timeseries: LoadDataPoint[] | null;
  /** UI technology IDs that are installed according to the model config. */
  installedTechIds: string[];
  /**
   * ignis (ISO 13790 annual heat demand) state.
   * Null until the building's country + type + construction period resolve
   * to at least one TABULA variant in the ignis service.
   */
  ignis: import('./ignisAdapter').IgnisState | null;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/** Maps BUEM building_type codes to human-readable labels. */
const BUILDING_TYPE_LABELS: Record<string, string> = {
  MFH: 'Multi-family House',
  SFH: 'Single-family House',
  AB:  'Apartment Block',
  TH:  'Terraced House',
};

/** Reverse of BUILDING_TYPE_LABELS, for serializing a label back to its BUEM code. */
const BUILDING_TYPE_CODES: Record<string, string> = Object.fromEntries(
  Object.entries(BUILDING_TYPE_LABELS).map(([code, label]) => [label, code]),
);

/**
 * Converts a BUEM element id to a readable label.
 * e.g. "Wall_1" -> "Wall 1", "Window_S" -> "Window S".
 */
function labelFromId(id: string): string {
  return id.replace(/_/g, ' ');
}

/**
 * Extracts the numeric value from a BUEM measurement object.
 * Returns `fallback` when the field is absent or not a valid number.
 */
function qty(obj: unknown, fallback = 0): number {
  if (obj && typeof obj === 'object' && 'value' in obj) {
    const n = Number((obj as { value: unknown }).value);
    return Number.isFinite(n) ? n : fallback;
  }
  return fallback;
}

/**
 * Converts the raw BUEM envelope element array into a keyed BuildingElement map.
 * Elements with an unrecognised type are skipped.
 */
function adaptEnvelope(elements: unknown[]): Record<string, BuildingElement> {
  const valid: BuildingElement['type'][] = ['wall', 'window', 'roof', 'floor', 'door'];
  const result: Record<string, BuildingElement> = {};

  elements.forEach((el) => {
    if (!el || typeof el !== 'object') return;

    const raw = el as Record<string, unknown>;
    const id   = String(raw.id ?? '');
    const type = String(raw.type ?? '') as BuildingElement['type'];

    if (!id || !valid.includes(type)) return;

    const gRaw = raw.g_gl;
    const gValue = (gRaw && typeof gRaw === 'object' && 'value' in gRaw)
      ? Number((gRaw as { value: unknown }).value)
      : null;

    result[id] = {
      id,
      label:   labelFromId(id),
      type,
      area:    qty(raw.area),
      uValue:  qty(raw.U),
      gValue:  gValue !== null && Number.isFinite(gValue) ? gValue : null,
      tilt:    qty(raw.tilt),
      azimuth: qty(raw.azimuth),
      source: 'city',
      customMode: false,
    };
  });

  return result;
}

/**
 * Converts the BUEM timeseries object into the LoadDataPoint array the chart viewer
 * expects. BUEM has no DHW timeseries, so hotwater is set to 0.
 *
 * BUEM timeseries shape:
 *   { unit, timestamps: string[], heating: number[], cooling: number[], electricity: number[] }
 */
function adaptTimeseries(ts: unknown): LoadDataPoint[] | null {
  if (!ts || typeof ts !== 'object') return null;

  const raw = ts as Record<string, unknown>;
  const timestamps  = Array.isArray(raw.timestamps)  ? raw.timestamps  as string[] : [];
  const heating     = Array.isArray(raw.heating)     ? raw.heating     as number[] : [];
  const electricity = Array.isArray(raw.electricity) ? raw.electricity as number[] : [];

  if (timestamps.length === 0) return null;

  // BUEM convention: demand is negative. Store as positive magnitudes so that
  // future production series (e.g. PV) can be overlaid on the same positive axis.
  return timestamps.map((timestamp, i) => ({
    timestamp,
    // No per-hour dhw/kitchen in this source; only a live BuEM run has them.
    dhw: 0,
    kitchen: 0,
    heating:     Number.isFinite(heating[i])     ? Math.abs(heating[i])     : 0,
    hotwater:    0,
    electricity: Number.isFinite(electricity[i]) ? Math.abs(electricity[i]) : 0,
  }));
}

function coordsFromFeature(feature: unknown): [number, number] {
  const coords = getMappedValue<unknown[]>(feature, MODEL_DATA_MAP.thematic.coordinates) ?? [];
  const lon = Number(coords[0] ?? 0);
  const lat = Number(coords[1] ?? 0);
  return [lon, lat];
}

function adaptGeometryData(feature: unknown): GeometryData {
  const [lon, lat] = coordsFromFeature(feature);
  const buildingHeight = getMappedValue<unknown>(feature, MODEL_DATA_MAP.geometry.buildingHeight);

  return {
    buildingId: String(getMappedValue(feature, MODEL_DATA_MAP.geometry.buildingId) ?? ''),
    coordinates: [lon, lat],
    buildingFootprint: getMappedValue(feature, MODEL_DATA_MAP.geometry.buildingFootprint) ?? null,
    buildingHeight: typeof buildingHeight === 'number' && Number.isFinite(buildingHeight)
      ? buildingHeight
      : null,
  };
}

function adaptThematicData(feature: unknown): ThematicData {
  const descriptor = MODEL_DATA_MAP.thematic.descriptor;
  const results = MODEL_DATA_MAP.thematic.results;
  const [lon, lat] = coordsFromFeature(feature);
  const rawId = String(getMappedValue(feature, MODEL_DATA_MAP.thematic.buildingId) ?? '');

  const typeCode = String(getMappedValue(feature, descriptor.buildingTypeCode) ?? '');
  const buildingType = BUILDING_TYPE_LABELS[typeCode] ?? typeCode;
  const identity: BuildingIdentity = {
    id: rawId,
    label: String(getMappedValue(feature, MODEL_DATA_MAP.thematic.label) ?? rawId),
    coordinates: [lon, lat],
    buildingType,
    // construction_period carries a plain year string here, not a { value } quantity.
    constructionYear: Number(getMappedValue(feature, descriptor.constructionYear)) || 0,
    country: String(getMappedValue(feature, descriptor.country) ?? ''),
    floorArea: getMappedNumber(feature, descriptor.floorArea),
    roomHeight: getMappedNumber(feature, descriptor.roomHeight),
    storeys: getMappedNumber(feature, descriptor.storeys),
  };

  const envelope = adaptEnvelope(getMappedArray(feature, MODEL_DATA_MAP.thematic.envelope.elements));
  const hasSummary = [
    results.heatingTotal,
    results.coolingTotal,
    results.electricityTotal,
    results.peakHeatingLoad,
    results.peakCoolingLoad,
    results.energyIntensity,
  ].some((path) => hasMappedValue(feature, path));
  const thermalSummary: ThermalSummary | null = hasSummary ? {
    heatingKwh: getMappedNumber(feature, results.heatingTotal),
    coolingKwh: getMappedNumber(feature, results.coolingTotal),
    electricityKwh: getMappedNumber(feature, results.electricityTotal),
    peakHeatingKw: getMappedNumber(feature, results.peakHeatingLoad),
    peakCoolingKw: getMappedNumber(feature, results.peakCoolingLoad),
    energyIntensityKwhM2: getMappedNumber(feature, results.energyIntensity),
    dhwKwh: getMappedNumber(feature, results.dhwTotal),
    kitchenGasKwh: getMappedNumber(feature, results.kitchenTotal),
    totalEnergyKwh: hasMappedValue(feature, results.totalEnergyDemand)
      ? getMappedNumber(feature, results.totalEnergyDemand)
      : getMappedNumber(feature, results.heatingTotal) + getMappedNumber(feature, results.coolingTotal)
        + getMappedNumber(feature, results.electricityTotal) + getMappedNumber(feature, results.dhwTotal),
  } : null;

  return {
    identity,
    envelope,
    thermalSummary,
    timeseries: adaptTimeseries(getMappedValue(feature, results.timeseries) ?? null),
  };
}

function adaptTechnologyData(feature: unknown): TechnologyData {
  const rawTechs = getMappedRecord(feature, MODEL_DATA_MAP.technologies.techRoot);
  const installedTechIds = Object.entries(MODEL_DATA_MAP.technologies.catalog)
    .filter(([, path]) => hasMappedValue(feature, path))
    .map(([id]) => id as InstalledTechnologyId);

  return { rawTechs, installedTechIds };
}

/** Extracts the three dashboard integration domains from a single feature. */
export function extractBuildingDashboardData(feature: unknown): Pick<BuildingState, 'geometry' | 'thematic' | 'technologies'> {
  return {
    geometry: adaptGeometryData(feature),
    thematic: adaptThematicData(feature),
    technologies: adaptTechnologyData(feature),
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Converts a single BUEM GeoJSON Feature into a BuildingState.
 * Throws if the input is not a valid BUEM Feature.
 */
export function adaptBuemFeature(feature: unknown): BuildingState {
  if (!feature || typeof feature !== 'object') {
    throw new Error('adaptBuemFeature: expected a GeoJSON Feature object.');
  }

  const { geometry, thematic, technologies } = extractBuildingDashboardData(feature);

  return {
    geometry,
    thematic,
    technologies,
    identity: thematic.identity,
    envelope: thematic.envelope,
    thermalSummary: thematic.thermalSummary,
    timeseries: thematic.timeseries,
    installedTechIds: technologies.installedTechIds,
    ignis: null,
  };
}

/**
 * Formats a coordinate pair as a display string.
 * e.g. [11.582, 48.135] -> "48.1350° N, 11.5820° E"
 */
export function formatCoordinates(lon: number, lat: number): string {
  const latStr = `${Math.abs(lat).toFixed(4)}° ${lat >= 0 ? 'N' : 'S'}`;
  const lonStr = `${Math.abs(lon).toFixed(4)}° ${lon >= 0 ? 'E' : 'W'}`;
  return `${latStr}, ${lonStr}`;
}

/**
 * Parses a load-profile CSV into LoadDataPoint[].
 *
 * Expected columns (case-insensitive): timesteps | datetime | timestamp,
 * electricity, heating, dhw | hotwater.
 * Rows that cannot be parsed are silently skipped.
 */
export function parseLoadProfileCsv(csv: string): LoadDataPoint[] {
  const lines = csv.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const tsIdx = headers.findIndex((h) => ['timesteps', 'datetime', 'timestamp', 'time', 'date'].includes(h));
  const elIdx = headers.findIndex((h) => ['electricity', 'power', 'el'].includes(h));
  const htIdx = headers.findIndex((h) => ['heating', 'heat'].includes(h));
  const hwIdx = headers.findIndex((h) => ['dhw', 'hotwater', 'hot_water'].includes(h));

  if (tsIdx === -1) return [];

  // BUEM convention: demand is negative. Negate here so all values are positive
  // magnitudes. When PV production is added it will also be stored as positive,
  // so overlapping lines on the chart directly show demand coverage.
  return lines.slice(1).flatMap((line) => {
    const cols = line.split(',');
    const timestamp = cols[tsIdx]?.trim() ?? '';
    if (!timestamp) return [];
    return [{
      timestamp,
      // An uploaded CSV has no dhw/kitchen columns; only a live BuEM run does.
      dhw: 0,
      kitchen: 0,
      electricity: elIdx >= 0 ? Math.abs(Number(cols[elIdx]) || 0) : 0,
      heating:     htIdx >= 0 ? Math.abs(Number(cols[htIdx]) || 0) : 0,
      hotwater:    hwIdx >= 0 ? Math.abs(Number(cols[hwIdx]) || 0) : 0,
    }];
  });
}

/**
 * Extracts building Features from an EnerPlanET config object.
 *
 * EnerPlanET topology format:
 *   { topology: [{ from: Feature, to: Feature }, ...] }
 *
 * Only `from` nodes with a `buem` block are treated as buildings.
 * Returns an empty array when no matching features are found.
 */
export function extractFeaturesFromConfig(config: unknown): unknown[] {
  if (!config || typeof config !== 'object') return [];

  const topology = (config as Record<string, unknown>).topology;
  if (!Array.isArray(topology)) return [];

  return topology
    .map((edge) => {
      if (!edge || typeof edge !== 'object') return null;
      return (edge as Record<string, unknown>).from ?? null;
    })
    .filter((node): node is Record<string, unknown> => {
      if (!node || typeof node !== 'object') return false;
      const props = (node as Record<string, unknown>).properties as Record<string, unknown> | undefined;
      return !!props?.buem;
    });
}

// ─── Export to BUEM API schema ─────────────────────────────────────────────────

/**
 * Serializes UI building element data to BUEM envelope element format.
 * Maps BuildingElement[] to BUEM's envelope.elements[] schema.
 */
function buildElementsToBuemEnvelope(elements: Record<string, any>): Array<Record<string, any>> {
  return Object.values(elements)
    .filter((el) => el && typeof el === 'object')
    .map((el) => {
      const base: Record<string, any> = {
        id: String(el.id ?? ''),
        type: String(el.type ?? ''),
      };

      // Human-readable display label — echoed by the server, not used in simulation.
      if (el.label) base.name = el.label;

      // Geometry fields: required for non-ventilation elements
      if (el.type !== 'ventilation') {
        base.area = { value: Number(el.area ?? 0), unit: 'm2' };
        base.azimuth = { value: Number(el.azimuth ?? 0), unit: 'deg' };
        base.tilt = { value: Number(el.tilt ?? 0), unit: 'deg' };
      }

      // Thermal properties
      if (typeof el.uValue === 'number') {
        base.U = { value: el.uValue, unit: 'W/(m2K)' };
      }

      // Solar gain (window-specific)
      if (el.type === 'window' && typeof el.gValue === 'number') {
        base.g_gl = { value: el.gValue, unit: '-' };
      }

      return base;
    });
}

/**
 * Converts the current UI state (elements + general config) to a complete BUEM GeoJSON Feature.
 * The feature can be exported and sent to the BUEM API for processing.
 *
 * @param identity - Building identity (id, coordinates, etc.)
 * @param elements - UI element record
 * @param general - General building config
 * @param startTime - ISO 8601 start time (e.g. "2018-01-01T00:00:00Z")
 * @param endTime - ISO 8601 end time
 * @param resolution - Time resolution value (default: 60)
 * @param resolutionUnit - Time resolution unit (default: "minutes")
 * @returns A BUEM GeoJSON Feature ready for export or API submission
 */
export function serializeToBuemFeature(
  identity: BuildingIdentity,
  elements: Record<string, any>,
  general: Record<string, any>,
  startTime: string = '2018-01-01T00:00:00Z',
  endTime: string = '2018-12-31T23:00:00Z',
  resolution: string | number = '60',
  resolutionUnit: string = 'minutes',
  batteryConfig?: Record<string, any>,
): Record<string, any> {
  const [lon, lat] = identity.coordinates;

  // Build the building block, preferring passed identity over general config
  const building: Record<string, any> = {};
  if (identity.buildingType) building.building_type = BUILDING_TYPE_CODES[identity.buildingType] ?? identity.buildingType;
  else if (general.buildingType) building.building_type = BUILDING_TYPE_CODES[general.buildingType] ?? general.buildingType.replace(/\s+/g, '_').toUpperCase();

  // construction_period is inert in the BUEM contract (classification metadata,
  // no simulation effect) and its true value is a per-country TABULA class code
  // BC does not hold. BC carries the plain construction year here instead, as a
  // string, so an exported feature round-trips.
  const constructionYear = identity.constructionYear || general.constructionYear;
  if (constructionYear) building.construction_period = String(constructionYear);

  if (identity.country) building.country = identity.country;
  else if (general.country) building.country = general.country;

  // Attached-neighbours code (B_Alone/B_N1/B_N2) — drives BuEM's shared-wall
  // transmission correction factor. Not consumed by ignis.
  if (general.Code_AttachedNeighbours) building.neighbour_status = general.Code_AttachedNeighbours;

  if (typeof identity.floorArea === 'number') {
    // identity.floorArea is already the total conditioned floor area (BuEM A_ref semantics).
    building.A_ref = { value: identity.floorArea, unit: 'm2' };
  } else if (typeof general.floorArea === 'number') {
    // general.floorArea is per-storey; A_ref needs the whole-building total.
    building.A_ref = { value: general.floorArea * (Number(general.storeys) || 1), unit: 'm2' };
  }

  if (typeof identity.roomHeight === 'number') {
    building.h_room = { value: identity.roomHeight, unit: 'm' };
  } else if (typeof general.roomHeight === 'number') {
    building.h_room = { value: general.roomHeight, unit: 'm' };
  }

  if (typeof identity.storeys === 'number') {
    building.n_storeys = identity.storeys;
  } else if (typeof general.storeys === 'number') {
    building.n_storeys = general.storeys;
  }

  // Envelope
  building.envelope = { elements: buildElementsToBuemEnvelope(elements) };

  // Thermal parameters
  const thermal: Record<string, any> = {};
  if (typeof general.n_air_infiltration === 'number') {
    thermal.n_air_infiltration = { value: general.n_air_infiltration, unit: '1/h' };
  }
  if (typeof general.n_air_use === 'number') {
    thermal.n_air_use = { value: general.n_air_use, unit: '1/h' };
  }
  if (typeof general.c_m === 'number') {
    thermal.c_m = { value: general.c_m, unit: 'kJ/(m2K)' };
  }
  if (general.massClass) {
    thermal.thermal_class =
      general.massClass === 'Medium' ? 'medium' :
      general.massClass === 'Heavy' ? 'heavy' : 'light';
  }
  if (Object.keys(thermal).length > 0) {
    building.thermal = thermal;
  }

  // Build the techs block.
  // Battery is included when installed, or when the registry marks it includeInModel = true
  // (e.g. when the card is hidden but the simulation engine still needs the params).
  const batteryDef = TECH_REGISTRY.find((t) => t.id === 'battery');
  const techs: Record<string, any> = {};
  if (batteryConfig && (batteryConfig.installed || batteryDef?.includeInModel)) {
    const b = batteryConfig;
    techs.battery_storage = {
      cont_energy_cap_max:                  b.cont_energy_cap_max,
      cont_energy_cap_min:                  b.cont_energy_cap_min,
      cont_storage_cap_max:                 b.cont_storage_cap_max,
      cont_storage_cap_min:                 b.cont_storage_cap_min,
      cont_energy_eff:                      b.cont_energy_eff,
      cont_storage_loss:                    b.cont_storage_loss,
      cont_storage_discharge_depth:         b.cont_storage_discharge_depth,
      cont_storage_initial:                 b.cont_storage_initial,
      cont_lifetime:                        b.cont_lifetime,
      cost_energy_cap:                      b.cost_energy_cap,
      cost_storage_cap:                     b.cost_storage_cap,
      cost_om_annual:                       b.cost_om_annual,
      cost_om_annual_investment_fraction:   0,
      cost_interest_rate:                   b.cost_interest_rate,
      cost_purchase:                        0,
      cost_export:                          0,
      cont_energy_cap_max_systemwide:       'inf',
      cont_export_cap:                      'inf',
    };
  }

  // Build the complete feature
  const feature: Record<string, any> = {
    type: 'Feature',
    id: identity.id,
    geometry: {
      type: 'Point',
      coordinates: [lon, lat],
    },
    properties: {
      start_time: startTime,
      end_time: endTime,
      resolution: String(resolution),
      resolution_unit: resolutionUnit,
      buem: {
        building,
        solver: {
          use_milp: general.use_milp ?? false,
          // compute_cooling is schema-only in the current BuEM release and
          // rejected if sent at all — heating and cooling are both always
          // computed unconditionally. Omit until BuEM wires the flag up.
        },
      },
      ...(Object.keys(techs).length > 0 ? { techs } : {}),
    },
  };

  return feature;
}

/**
 * Exports the current UI state as a BUEM API-compliant GeoJSON FeatureCollection.
 * This is the format expected by the BUEM microservice.
 */
export function exportToBuemGeojson(
  identity: BuildingIdentity,
  elements: Record<string, any>,
  general: Record<string, any>,
  startTime?: string,
  endTime?: string,
  batteryConfig?: Record<string, any>,
): string {
  const feature = serializeToBuemFeature(identity, elements, general, startTime, endTime, '60', 'minutes', batteryConfig);
  const featureCollection = {
    type: 'FeatureCollection',
    features: [feature],
  };
  return JSON.stringify(featureCollection, null, 2);
}

// ─── Import from BUEM API schema ──────────────────────────────────────────────

/**
 * Represents both legacy export format and new BUEM API format.
 */
export interface ImportedBuildingData {
  elements: Record<string, any>;
  general: Record<string, any>;
  roofConfig?: Record<string, any>;
  isBuemFormat: boolean;
}

/**
 * Parses a BUEM API Feature into the UI's element and general config format.
 * Handles both v3 unified building type codes and legacy separate fields.
 *
 * Throws if the input is not a valid BUEM Feature.
 */
export function parseBuemFeatureForImport(feature: unknown): ImportedBuildingData {
  if (!feature || typeof feature !== 'object') {
    throw new Error('parseBuemFeatureForImport: expected a GeoJSON Feature object.');
  }

  const f = feature as Record<string, unknown>;
  const props = (f.properties ?? {}) as Record<string, unknown>;
  const buem = (props.buem ?? {}) as Record<string, unknown>;
  const bldg = (buem.building ?? {}) as Record<string, unknown>;
  const thermalBlk = (bldg.thermal ?? {}) as Record<string, unknown>;
  const envelopeBlk = (bldg.envelope ?? {}) as Record<string, unknown>;
  const elements: Record<string, any> = {};

  // Parse envelope elements
  if (Array.isArray(envelopeBlk.elements)) {
    envelopeBlk.elements.forEach((el: any) => {
      if (!el || typeof el !== 'object') return;
      const id = String(el.id ?? '');
      if (!id) return;

      elements[id] = {
        id,
        label: id.replace(/_/g, ' '),
        type: String(el.type ?? ''),
        area: qty(el.area),
        uValue: qty(el.U),
        gValue: (el.g_gl && typeof el.g_gl === 'object' && 'value' in el.g_gl)
          ? Number((el.g_gl as any).value)
          : null,
        tilt: qty(el.tilt),
        azimuth: qty(el.azimuth),
        source: 'city',
        customMode: false,
      };
    });
  }

  // Parse general config. bldg.A_ref is the total conditioned floor area; general.floorArea
  // is per-storey, so divide by the building's own storey count.
  const importedStoreys = Number(bldg.n_storeys ?? 0);
  const importedYear = Number(bldg.construction_period) || 0;
  const general: Record<string, any> = {
    // Omitted when unparseable so a { ...DEFAULT_GENERAL, ...general } merge keeps the default.
    ...(importedYear ? { constructionYear: importedYear } : {}),
    buildingType: String(bldg.building_type ?? bldg.type ?? ''),
    country: String(bldg.country ?? ''),
    Code_AttachedNeighbours: String(bldg.neighbour_status ?? 'B_Alone'),
    floorArea: qty(bldg.A_ref) / Math.max(1, importedStoreys),
    roomHeight: qty(bldg.h_room),
    storeys: importedStoreys,
    n_air_infiltration: qty(thermalBlk.n_air_infiltration, 0.5),
    n_air_use: qty(thermalBlk.n_air_use, 0.5),
    c_m: qty(thermalBlk.c_m, 165),
    massClass: (thermalBlk.thermal_class === 'medium' ? 'Medium' :
                thermalBlk.thermal_class === 'heavy' ? 'Heavy' : 'Light'),
    use_milp: ((buem.solver ?? {}) as Record<string, unknown>).use_milp === true,
    compute_cooling: ((buem.solver ?? {}) as Record<string, unknown>).compute_cooling !== false,
  };

  return { elements, general, isBuemFormat: true };
}

/**
 * Imports building data from either:
 * 1. Legacy configurator export format (with 'elements', 'generalConfig', 'roofConfig')
 * 2. BUEM API GeoJSON Feature or FeatureCollection
 * 3. EnerPlanET config.json topology
 *
 * Returns parsed element and general config, ignoring unrecognized fields.
 */
export function importBuildingData(json: unknown): ImportedBuildingData {
  if (!json || typeof json !== 'object') {
    throw new Error('importBuildingData: expected a JSON object.');
  }

  const data = json as Record<string, unknown>;

  // Check for legacy configurator format first
  if ('elements' in data || 'generalConfig' in data) {
    return {
      elements: (data.elements ?? {}) as Record<string, any>,
      general: (data.generalConfig ?? data.general ?? {}) as Record<string, any>,
      roofConfig: (data.roofConfig ?? {}) as Record<string, any>,
      isBuemFormat: false,
    };
  }

  // Check for BUEM FeatureCollection
  if (data.type === 'FeatureCollection' && Array.isArray(data.features)) {
    const features = data.features as unknown[];
    if (features.length > 0) {
      return parseBuemFeatureForImport(features[0]);
    }
    throw new Error('importBuildingData: FeatureCollection contains no features.');
  }

  // Check for single BUEM Feature
  if (data.type === 'Feature') {
    return parseBuemFeatureForImport(data);
  }

  // Check for EnerPlanET config with topology
  if ('topology' in data && Array.isArray(data.topology)) {
    const features = extractFeaturesFromConfig(data);
    if (features.length > 0 && features[0]) {
      return parseBuemFeatureForImport(features[0]);
    }
  }

  throw new Error(
    'importBuildingData: unrecognized format. '
    + 'Expected legacy configurator JSON, BUEM GeoJSON Feature, FeatureCollection, or EnerPlanET config.json.',
  );
}
