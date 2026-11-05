import { ModelResults } from '@/features/model-results/types';
import { CapacityData } from '@/features/simulation-charts/types';
import { getPrimaryFClass, normalizeFClass, formatFClassLabel } from './fClassUtils';

interface CapacityBuildingsSource {
  features?: Array<{
    geometry?: unknown;
    properties?: Record<string, unknown>;
  }>;
}

// Technology display names
const TECH_NAMES: Record<string, string> = {
  pv_supply: 'Solar PV',
  wind_supply: 'Wind',
  wind_onshore: 'Wind (Onshore)',
  wind_offshore: 'Wind (Offshore)',
  biomass_supply: 'Biomass',
  battery_storage: 'Battery Storage',
  geothermal_supply: 'Geothermal',
  water_supply: 'Hydro Power',
  transformer_supply: 'Grid Import',
  power_grid_supply: 'Grid Import',
  power_transmission: 'Power Transmission',
  sfh_demand: 'Single Family House',
  th_demand: 'Townhouse',
  mfh_demand: 'Multi Family House',
  ab_demand: 'Apartment Block',
  commercial_demand: 'Commercial',
  public_demand: 'Public Building',
  industrial_demand: 'Industrial',
  agricultural_demand: 'Agricultural',
};

// Tech name to translation key mapping
const TECH_TRANSLATION_KEYS: Record<string, string> = {
  pv_supply: 'results.techNames.solarPv',
  wind_supply: 'results.techNames.wind',
  wind_onshore: 'results.techNames.windOnshore',
  wind_offshore: 'results.techNames.windOffshore',
  biomass_supply: 'results.techNames.biomass',
  battery_storage: 'results.techNames.batteryStorage',
  geothermal_supply: 'results.techNames.geothermal',
  water_supply: 'results.techNames.hydroPower',
  transformer_supply: 'results.techNames.gridImport',
  power_grid_supply: 'results.techNames.gridImport',
  power_transmission: 'results.techNames.powerTransmission',
  sfh_demand: 'results.techNames.sfhDemand',
  th_demand: 'results.techNames.thDemand',
  mfh_demand: 'results.techNames.mfhDemand',
  ab_demand: 'results.techNames.abDemand',
  commercial_demand: 'results.techNames.commercialDemand',
  public_demand: 'results.techNames.publicDemand',
  industrial_demand: 'results.techNames.industrialDemand',
  agricultural_demand: 'results.techNames.agriculturalDemand',
};

// Technology colors


type TranslateFunction = (key: string) => string;

const EXCLUDED_CAPACITY_TECHS = new Set([
  'power_transmission',
  'transformer_supply',
]);

/**
 * The technology without its location and its building and roof numbers, which
 * T1K appends per building: "pv_supply_20_13:n20" -> "pv_supply".
 */
function getBaseTech(tech: string): string {
  if (!tech) return '';
  return tech.split(':', 1)[0].trim().replace(/(_\d+)+$/, '');
}

/**
 * The technology summed over buildings and transformers, also dropping numbers
 * inside the name: "grid_trafo_101197_import" -> "grid_trafo_import". Same rule
 * as techGroupSQL in the backend result store.
 */
export function getTechGroup(tech: string): string {
  return getBaseTech(tech).replace(/_\d+(?=_|$)/g, '');
}

function isCapacityChartTech(tech: string): boolean {
  const baseTech = getBaseTech(tech).toLowerCase();
  return Boolean(baseTech) && !EXCLUDED_CAPACITY_TECHS.has(baseTech);
}

function getTechDisplayName(tech: string, t?: TranslateFunction): string {
  if (t && TECH_TRANSLATION_KEYS[tech]) {
    return t(TECH_TRANSLATION_KEYS[tech]);
  }
  return TECH_NAMES[tech] || tech.replaceAll('_', ' ').replaceAll(/\b\w/g, c => c.toUpperCase());
}

function getTechType(tech: string): 'supply' | 'demand' {
  const lower = tech.toLowerCase();
  if (lower.includes('demand') || lower.includes('load') || lower.includes('consumption')) {
    return 'demand';
  }
  // Residential f-class types often don't have 'demand' in the raw key but are loads
  const demandKeywords = ['sfh', 'mfh', 'th', 'ab', 'commercial', 'public', 'industrial', 'agricultural'];
  if (demandKeywords.some(k => lower.includes(k))) {
    return 'demand';
  }
  return 'supply';
}

/** Group of the buildings whose usage is unknown (OSM building=yes and similar). */
const OTHER_BUILDINGS = 'other_buildings';

/**
 * Map each demand node location to its building's primary f_class, via a
 * spatial join: a building's footprint centre is matched to the nearest result
 * node (results coordinates are stored as {x: lon, y: lat}, building geometry
 * is GeoJSON [lon, lat]). The building's use from its analysis (use_type)
 * comes before its f_class. A building without either maps to
 * OTHER_BUILDINGS, so unknown usage forms one group rather than one per node.
 */
export function buildLocationToFClass(
  coordinates: Record<string, { x: number; y: number }>,
  buildings?: CapacityBuildingsSource,
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const feature of buildings?.features ?? []) {
    const props = feature.properties ?? {};
    const useType = typeof props.use_type === 'string' ? props.use_type : '';
    const fClass = useType || getPrimaryFClass(props) || normalizeFClass(String(props.f_class ?? '')) || OTHER_BUILDINGS;

    const centre = geometryCentreLonLat(feature.geometry);
    if (!centre) continue;
    const [lon, lat] = centre;
    const nodeId = droppableClosestTo(lon, lat, coordinates);
    if (!nodeId) continue;
    if (!map[nodeId]) map[nodeId] = fClass;
  }
  return map;
}

/** Approximate footprint centre in [lon, lat] from a (Multi)Polygon. */
function geometryCentreLonLat(geometry: unknown): [number, number] | null {
  if (!geometry || typeof geometry !== 'object') return null;
  const coords = (geometry as { coordinates?: unknown }).coordinates;
  const points: Array<[number, number]> = [];
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) {
      if (v.length >= 2 && typeof v[0] === 'number' && typeof v[1] === 'number') {
        points.push([v[0], v[1]]);
      } else {
        v.forEach(walk);
      }
    }
  };
  walk(coords);
  if (points.length === 0) return null;
  const lon = points.reduce((s, p) => s + p[0], 0) / points.length;
  const lat = points.reduce((s, p) => s + p[1], 0) / points.length;
  return [lon, lat];
}

/**
 * Nearest non-transformer result node to a [lon, lat] point, within a tight
 * tolerance (degrees). Result coords are stored {x: lat, y: lon}, so the
 * lon-ly/ lat-x pairing mirrors the map's existing spatial match.
 */
function droppableClosestTo(
  lon: number,
  lat: number,
  coordinates: Record<string, { x: number; y: number }>,
): string | undefined {
  let bestId: string | undefined;
  let bestDist = Infinity;
  for (const [locId, coord] of Object.entries(coordinates)) {
    if (locId.toLowerCase().includes('trafo')) continue;
    const dist = Math.hypot(lon - coord.x, lat - coord.y);
    if (dist < bestDist && dist < 0.001) {
      bestDist = dist;
      bestId = locId;
    }
  }
  return bestId;
}

/**
 * Transform energy capacity data for the capacity chart.
 *
 * Supply techs are grouped by base technology as before. Demand entries are
 * grouped by the building's f_class (via {@link buildLocationToFClass}) so a
 * grid with many buildings collapses into a few sector/category bars instead
 * of one bar per node id. Falls back to the raw demand tech label when no
 * f_class resolves.
 */
export function transformToCapacityData(
  results: ModelResults,
  t?: TranslateFunction,
  buildings?: CapacityBuildingsSource,
): CapacityData[] {
  if (!results.energy_cap || results.energy_cap.length === 0) {
    return [];
  }

  const locationToFClass = buildings ? buildLocationToFClass(results.coordinates ?? {}, buildings) : {};

  // Grouped capacity, keyed by the bar's stable identity: supply uses the tech
  // name, demand uses the resolved f_class (or the demand tech as fallback).
  const buckets = new Map<string, { tech: string; isDemand: boolean }>();
  const bucketCapacity: Record<string, number> = {};
  // A bar's capacity factor is the capacity-weighted mean of its members'.
  const bucketUtilised: Record<string, number> = {};

  const demandKeyFor = (location: string, tech: string): string => {
    const fClass = locationToFClass[location];
    // Group all buildings of the same f_class into one sector bar; fall back to
    // the demand tech label when no f_class resolves.
    if (fClass) return `demand:${fClass}`;
    return tech;
  };

  // Get capacity factors for each tech.
  // Some payloads store factors as "tech:location", while energy_cap uses base tech names.
  const capacityFactorsExact: Record<string, number> = {};
  const capacityFactorsByBaseMax: Record<string, number> = {};
  if (results.systemwide_capacity_factor) {
    results.systemwide_capacity_factor.forEach(cf => {
      if (!Number.isFinite(cf.value)) return;
      const clamped = Math.max(0, Math.min(1, cf.value));
      // One row per carrier; a tech produces one carrier and reads 0 on the others.
      capacityFactorsExact[cf.techs] = Math.max(capacityFactorsExact[cf.techs] ?? 0, clamped);

      const baseTech = getBaseTech(cf.techs);
      const prev = capacityFactorsByBaseMax[baseTech];
      capacityFactorsByBaseMax[baseTech] = prev === undefined ? clamped : Math.max(prev, clamped);
    });
  }

  results.energy_cap.forEach(cap => {
    const tech = getBaseTech(cap.tech || '');
    if (!isCapacityChartTech(tech)) return;
    const type = getTechType(tech);
    const key = type === 'demand' ? demandKeyFor(cap.location || '', tech) : tech;

    if (!buckets.has(key)) {
      buckets.set(key, { tech, isDemand: type === 'demand' });
    }
    bucketCapacity[key] = (bucketCapacity[key] ?? 0) + cap.value;
    const factor = capacityFactorsExact[cap.tech || '']
      ?? capacityFactorsExact[`${cap.tech}:${cap.location}`]
      ?? capacityFactorsByBaseMax[tech] ?? 0;
    bucketUtilised[key] = (bucketUtilised[key] ?? 0) + cap.value * factor;
  });

  return Array.from(buckets.entries())
    .filter(([key]) => (bucketCapacity[key] ?? 0) > 0)
    .map(([key, { tech, isDemand }]) => {
      const value = bucketCapacity[key] ?? 0;
      const type = isDemand ? 'demand' as const : getTechType(tech);
      // Demand grouped by f_class: label with the building category name.
      const technology = isDemand
        ? techLabelForDemandGroup(key, tech, t)
        : getTechDisplayName(tech, t);
      const capacityFactor = value > 0 ? (bucketUtilised[key] ?? 0) / value : 0;

      return {
        technology,
        installed_capacity_kw: value,
        utilized_capacity_kw: value * capacityFactor,
        capacity_factor: capacityFactor,
        type,
      };
    })
    .sort((a, b) => b.installed_capacity_kw - a.installed_capacity_kw);
}

/** Human label for a demand f_class group, e.g. "demand:school" -> "school". */
function techLabelForDemandGroup(groupKey: string, fallbackTech: string, t?: TranslateFunction): string {
  const fClass = groupKey.split(':', 2)[1];
  if (fClass === OTHER_BUILDINGS) return t ? t('results.techNames.otherBuildings') : 'Other buildings';
  if (fClass) {
    const normalized = normalizeFClass(fClass);
    return normalized ? formatFClassLabel(normalized) : getTechDisplayName(fallbackTech, t);
  }
  return getTechDisplayName(fallbackTech, t);
}
