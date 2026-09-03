// ---------------------------------------------------------------------------
// Expected-fit table — building f-class to most likely heat tech.
// Heuristic, review-flagged, user-overridable, "estimated"-badged.
// TEMPORARY harness data.
// ---------------------------------------------------------------------------

/** The universal fallback tech: exists in OpenTech-DB, always solvable. */
export const SIMPLE_DEFAULT_TECH = 'electric_boilers';

/** f-class → OpenTech-DB tech slug (expected-fit mode). */
const EXPECTED_FIT: Record<string, string> = {
  // residential
  sfh: 'air_source_heat_pump',
  detached: 'air_source_heat_pump',
  semidetached_house: 'air_source_heat_pump',
  terrace: 'air_source_heat_pump',
  townhouse: 'air_source_heat_pump',
  house: 'air_source_heat_pump',
  bungalow: 'air_source_heat_pump',
  apartment: 'gas_boiler',
  apartments: 'gas_boiler',
  mfh: 'gas_boiler',
  residential: 'gas_boiler',
  dormitory: 'gas_boiler',
  // commercial
  office: 'air_source_heat_pump',
  commercial: 'air_source_heat_pump',
  retail: 'air_source_heat_pump',
  shop: 'air_source_heat_pump',
  supermarket: 'gas_boiler',
  warehouse: 'gas_boiler',
  restaurant: 'gas_boiler',
  hotel: 'gas_boiler',
  // industrial
  industrial: 'chp_gas',
  factory: 'chp_gas',
  manufacture: 'chp_gas',
  workshop: 'gas_boiler',
  // public
  school: 'gas_boiler',
  university: 'gas_boiler',
  church: 'gas_boiler',
  library: 'gas_boiler',
  hospital: 'chp_gas',
  clinic: 'chp_gas',
  // agriculture
  farm: 'biomass_chp',
  barn: 'biomass_chp',
  stable: 'biomass_chp',
  greenhouse: 'air_source_heat_pump', // solar thermal not in the catalogue
};

/** Expected-fit tech for a building class; falls back to the simple default. */
export function expectedFitTech(fClass: string): string {
  const norm = fClass.toLowerCase();
  return EXPECTED_FIT[norm] ?? SIMPLE_DEFAULT_TECH;
}

/** All tech slugs the table can produce (for catalog-awareness checks). */
export function expectedFitSlugs(): string[] {
  return Array.from(new Set(Object.values(EXPECTED_FIT)));
}