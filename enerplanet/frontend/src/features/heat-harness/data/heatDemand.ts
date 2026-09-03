// ---------------------------------------------------------------------------
// Heat demand estimation — ported subset of the backend payload builder's
// specificHeatDemandByFClass (kWh/sqm/yr, TABULA-flavored defaults).
// TEMPORARY harness data; BuEM envelopes replace these later.
// ---------------------------------------------------------------------------

/** Building classes treated as zero-demand (shed, garages, ruins, ...). */
export const ZERO_DEMAND_CLASSES = [
  'shed', 'roof', 'ruins', 'garage', 'carport', 'parking', 'bunker',
] as const;

export const SPECIFIC_HEAT_DEMAND: Record<string, number> = {
  // residential
  apartment: 90,
  apartments: 85,
  mfh: 85,
  sfh: 100,
  detached: 100,
  semidetached_house: 95,
  terrace: 85,
  townhouse: 85,
  house: 100,
  residential: 90,
  bungalow: 95,
  dormitory: 80,
  // commercial
  office: 80,
  commercial: 85,
  retail: 90,
  shop: 90,
  supermarket: 110,
  warehouse: 60,
  // industrial
  industrial: 100,
  factory: 120,
  manufacture: 110,
  workshop: 100,
  // public
  school: 90,
  university: 95,
  church: 80,
  hospital: 200,
  clinic: 180,
  library: 90,
  // agriculture
  farm: 100,
  barn: 60,
  stable: 80,
  greenhouse: 250,
  // other
  hotel: 130,
  restaurant: 140,
  // fallbacks
  default: 80,
};

/** Common f-classes offered in the harness building picker. */
export const COMMON_F_CLASSES: { key: string; label: string }[] = [
  { key: 'sfh', label: 'Single-family house (sfh)' },
  { key: 'apartments', label: 'Apartment complex (mfh)' },
  { key: 'industrial', label: 'Industrial complex' },
  { key: 'office', label: 'Office / commercial' },
  { key: 'school', label: 'School / public' },
  { key: 'hospital', label: 'Hospital / clinic' },
  { key: 'farm', label: 'Farm / agricultural' },
  { key: 'greenhouse', label: 'Greenhouse' },
  { key: 'shed', label: 'Shed / zero demand' },
];

export function isZeroDemandClass(fClass: string): boolean {
  return (ZERO_DEMAND_CLASSES as readonly string[]).includes(fClass.toLowerCase());
}

/** Yearly heat demand in kWh. Explicit demand wins; else area × specific. */
export function estimateHeatDemand(fClass: string, areaSqm: number, explicitKwh?: number): number {
  if (explicitKwh !== undefined && explicitKwh > 0) return explicitKwh;
  if (isZeroDemandClass(fClass)) return 0;
  if (areaSqm <= 0) return 0;
  const specific = SPECIFIC_HEAT_DEMAND[fClass.toLowerCase()] ?? SPECIFIC_HEAT_DEMAND.default;
  return Math.round(areaSqm * specific);
}