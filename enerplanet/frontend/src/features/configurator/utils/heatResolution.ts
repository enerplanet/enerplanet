// ---------------------------------------------------------------------------
// Heat resolution (supply side) — expected-fit table + resolution helpers.
// Port of the harness demo (~/Roo-TMP/heat-harness/data/expectedFit.ts) into the
// production configurator flow (plan §1). Heuristic, review-flagged, user-
// overridable; auto-assigned techs are badged "estimated" in the UI.
//
// One resolver: expected-demand→tech ; one detector: does a building's
// assigned techs resolve its heat demand.
// ---------------------------------------------------------------------------

import { normalizeFClass } from "./fClassUtils";
import { isZeroHeatDemandClass } from "./heatDemand";
import type { Technology } from "@/features/technologies/services/technologyService";
import { HEAT_SUPPLY_TYPES, asBuildingTechnology, defaultProduct, loadCatalogue } from "@/features/technologies/catalogue";

/** The universal fallback tech: always solvable. */
export const SIMPLE_DEFAULT_TECH = "electric_boilers";

/** f-class → heat technology type (expected-fit mode). */
const EXPECTED_FIT: Record<string, string> = {
  // residential
  sfh: "air_source_heat_pump",
  detached: "air_source_heat_pump",
  semidetached_house: "air_source_heat_pump",
  terrace: "air_source_heat_pump",
  townhouse: "air_source_heat_pump",
  house: "air_source_heat_pump",
  bungalow: "air_source_heat_pump",
  apartment: "gas_boiler",
  apartments: "gas_boiler",
  mfh: "gas_boiler",
  residential: "gas_boiler",
  dormitory: "gas_boiler",
  // commercial
  office: "air_source_heat_pump",
  commercial: "air_source_heat_pump",
  retail: "air_source_heat_pump",
  shop: "air_source_heat_pump",
  supermarket: "gas_boiler",
  warehouse: "gas_boiler",
  restaurant: "gas_boiler",
  hotel: "gas_boiler",
  // industrial
  industrial: "gas_boiler",
  factory: "gas_boiler",
  manufacture: "gas_boiler",
  workshop: "gas_boiler",
  // public
  school: "gas_boiler",
  university: "gas_boiler",
  church: "gas_boiler",
  library: "gas_boiler",
  hospital: "gas_boiler",
  clinic: "gas_boiler",
  // agriculture
  farm: "gas_boiler",
  barn: "gas_boiler",
  stable: "gas_boiler",
  greenhouse: "air_source_heat_pump", // solar thermal not in catalog — see plan §1
};


/** Expected-fit tech slug for a normalized f-class; falls back to the simple default. */
export function expectedFitTech(fClass: string): string {
  return EXPECTED_FIT[normalizeFClass(fClass)] ?? SIMPLE_DEFAULT_TECH;
}

/** All tech slugs the table can produce (for catalog-awareness checks). */
export function expectedFitSlugs(): string[] {
  return Array.from(new Set(Object.values(EXPECTED_FIT)));
}

export interface HeatTechResolution {
  /** Heat technology type to assign. */
  techKey: string;
  /** Always true — auto-resolve is provisional until the user overrides. */
  estimated: boolean;
}

/**
 * Resolve the expected-fit heat tech for a building, or null when there is nothing
 * to resolve (zero-demand f-class, or no heat demand). Outputting null for
 * zero demand ensures sheds/roofs/garages never get a bogus assignment.

 **/
export function resolveHeatTechForBuilding(
  fClass: string | undefined,
  demandHeatKwh: number | undefined
): HeatTechResolution | null {
  if (isZeroHeatDemandClass(String(fClass ?? "")) || (demandHeatKwh ?? 0) <= 0) return null;
  const norm = normalizeFClass(String(fClass ?? ""));
  const techKey = EXPECTED_FIT[norm] ?? SIMPLE_DEFAULT_TECH;
  return { techKey, estimated: true };
}

/** True when the building's assigned techs include at least one heat-supplying tech. */
export function hasHeatTech(techs: Record<string, unknown> | undefined): boolean {
  return Object.keys(techs ?? {}).some((key) => HEAT_SUPPLY_TYPES.includes(key));
}

/**
 * The default catalogue product of the heat technology type, as a building stores
 * it, or undefined when the catalogue has none (the blocking validator then flags
 * the building).
 */
export async function resolveHeatTechAssignment(techKey: string): Promise<Technology | undefined> {
  const product = defaultProduct(await loadCatalogue(), techKey);
  return product && asBuildingTechnology(product);
}