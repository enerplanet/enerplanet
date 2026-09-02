// ---------------------------------------------------------------------------
// Building heat demand estimation — frontend mirror of the BACKEND's temporary
// TABULA-flavored defaults (backend: internal/payload/payload_building_helpers.go
// specificHeatDemandByFClass). The backend generates these at payload-build
// time but does NOT persist them to model.config, so the frontend recomputes
// the same values for display. Once real heat demand data flows (BuEM /
// persisted config), read props.demand_heat instead and skip estimation.
// Estimated values are flagged with the "estimated" badge in the UI.
// ---------------------------------------------------------------------------

/** Building classes treated as zero-demand (mirrors backend). */
const ZERO_DEMAND_CLASSES = [
  'shed', 'roof', 'ruins', 'garage', 'carport', 'parking', 'bunker', 'collapsed',
] as const;

/** kWh/sqm/year keyed by normalized f-class (subset of the backend map). */
const SPECIFIC_HEAT_DEMAND: Record<string, number> = {
  // residential
  apartment: 90, apartments: 85, mfh: 85, sfh: 100, detached: 100,
  semidetached_house: 95, terrace: 85, townhouse: 85, house: 100,
  residential: 90, bungalow: 95, dormitory: 80,
  // commercial
  office: 80, commercial: 85, retail: 90, shop: 90, supermarket: 110,
  mall: 100, warehouse: 60, restaurant: 140, cafe: 130, hotel: 130,
  // industrial
  industrial: 100, factory: 120, manufacture: 110, workshop: 100, logistics: 60,
  // public
  school: 90, university: 95, kindergarten: 100, hospital: 200, clinic: 180,
  healthcare: 180, nursing_home: 150, church: 80, place_of_worship: 80,
  museum: 80, theatre: 100, library: 90, courthouse: 90, government: 90,
  police: 90, fire_station: 100, community_centre: 90, sports_centre: 120,
  swimming_pool: 300, public: 85,
  // agriculture
  farm: 100, farmhouse: 100, barn: 60, stable: 80, agricultural: 80,
  greenhouse: 250, cowshed: 80,
  // other
  data_center: 150, station: 120, train_station: 120,
  // fallback
  default: 80,
};

const CATEGORY_FALLBACK: Record<string, number> = {
  public: 90,
  industrial: 90,
  agricultural: 80,
  commercial: 80,
  residential: 90,
};

const normalizeFClass = (fClass: string): string =>
  (fClass || '').toLowerCase().replace(/[\s-]+/g, '_');

export function isZeroHeatDemandClass(fClass: string): boolean {
  const norm = normalizeFClass(fClass);
  return (ZERO_DEMAND_CLASSES as readonly string[]).includes(norm);
}

function inferCategory(fClass: string): string {
  const fc = normalizeFClass(fClass);
  if (/(house|apartment|residential|dormitory|villa|terrace|townhouse|bungalow|sfh|mfh)/.test(fc)) return 'residential';
  if (/(school|hospital|university|church|government|community|library|museum|theatre|clinic|healthcare)/.test(fc)) return 'public';
  if (/(factory|industrial|warehouse|workshop|manufacture|sewage|logistics|station|substation|power)/.test(fc)) return 'industrial';
  if (/(farm|barn|greenhouse|agricultural|stable|cowshed)/.test(fc)) return 'agricultural';
  return 'commercial';
}

function specificHeatDemand(fClass: string): number {
  const norm = normalizeFClass(fClass);
  const direct = SPECIFIC_HEAT_DEMAND[norm];
  if (direct !== undefined) return direct;
  return CATEGORY_FALLBACK[inferCategory(fClass)] ?? SPECIFIC_HEAT_DEMAND.default;
}

/**
 * Yearly heat demand in kWh for a building.
 * Prefer props.demand_heat (explicit/persisted); fall back to the backend's
 * TABULA-style area × specific estimation.
 */
export function estimateYearlyHeatDemand(
  fClass: string | undefined,
  areaSqm: number | undefined,
  explicitHeatKwh?: number
): { kwh: number; estimated: boolean } {
  if (explicitHeatKwh !== undefined && explicitHeatKwh > 0) {
    return { kwh: explicitHeatKwh, estimated: false };
  }
  if (!fClass || isZeroHeatDemandClass(fClass) || !areaSqm || areaSqm <= 0) {
    return { kwh: 0, estimated: false };
  }
  return { kwh: Math.round(areaSqm * specificHeatDemand(fClass)), estimated: true };
}