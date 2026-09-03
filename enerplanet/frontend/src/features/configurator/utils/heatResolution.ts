// ---------------------------------------------------------------------------
// Heat resolution (supply side) — expected-fit table + resolution helpers.
// Port of the harness demo (~/Roo-TMP/heat-harness/data/expectedFit.ts) into the
// production configurator flow (plan §1). Heuristic, review-flagged, user-
// overridable; auto-assigned techs are badged "estimated" in the UI.
//
// One resolver: expected-demand→tech ; one detector: hashould a building's
// assigned techs resolve its heat demand. Heat tech assignment is OTDB-sourced
// (carrier_out === heat in the bridge), except mixed-output techs (CHP /
// biomass_CHP) which the legacy bridge maps with carrier_out === electricity (their
// first output carrier) — those are still heat-production-capable and must count.
// ---------------------------------------------------------------------------

import { normalizeFClass } from "./fClassUtils";
import { isZeroHeatDemandClass } from "./heatDemand";
import { OTDB_CARRIER_OUT_KEY, fetchOpenTechTechBySlug } from "@/features/configurator/services/opentechdbService";

/** The universal fallback tech: exists in OpenTech-DB, always solvable. */
export const SIMPLE_DEFAULT_TECH = "electric_boilers";

/** f-class → OpenTech-DB tech slug (expected-fit mode). */
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
  industrial: "chp_gas",
  factory: "chp_gas",
  manufacture: "chp_gas",
  workshop: "gas_boiler",
  // public
  school: "gas_boiler",
  university: "gas_boiler",
  church: "gas_boiler",
  library: "gas_boiler",
  hospital: "chp_gas",
  clinic: "chp_gas",
  // agriculture
  farm: "biomass_chp",
  barn: "biomass_chp",
  stable: "biomass_chp",
  greenhouse: "air_source_heat_pump", // solar thermal not in catalog — see plan §1
};

/** Mixed-output heat producers the legacy bridge maps with carrier_out=electricity. */
const MIXED_OUTPUT_HEAT_SLUGS = new Set<string>(["chp_gas", "biomass_chp"]);

type HeatTechData = { alias?: string; icon?: string; constraints?: { key: string; value: unknown }[] };

/** Expected-fit tech slug for a normalized f-class; falls back to the simple default. */
export function expectedFitTech(fClass: string): string {
  return EXPECTED_FIT[normalizeFClass(fClass)] ?? SIMPLE_DEFAULT_TECH;
}

/** All tech slugs the table can produce (for catalog-awareness checks). */
export function expectedFitSlugs(): string[] {
  return Array.from(new Set(Object.values(EXPECTED_FIT)));
}

export interface HeatTechResolution {
  /** OpenTech-DB slug to assign. */
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

/**
 * True when an assigned tech produces heat — either the legacy bridge tagged it
 * carrier_out=heat (HP, boilers, thermal storage) or it is a known mixed-output
 * heat producer (CHP, biomass_CHP) mapped as electricity.
 */
function isHeatTech(techKey: string, tech: HeatTechData): boolean {
  if (MIXED_OUTPUT_HEAT_SLUGS.has(techKey)) return true;
  return (tech.constraints ?? []).some(
    (c) => c.key === OTDB_CARRIER_OUT_KEY && c.value === "heat"
  );
}

/** True when the building's assigned techs include at least one heat-resolving tech. */
export function hasHeatTech(techs: Record<string, HeatTechData> | undefined): boolean {
  return Object.entries(techs ?? {}).some(([key, tech]) => isHeatTech(key, tech));
}

/**
 * Resolve the heat-tech assignment for the tech slug (warm catalog read).
 * Returns the mapped tech when the catalog holds it (for persisting alias/icon/
 * constraints with the manual-assign path), or undefined when the catalog is not yet
 * warm / the slug is absent — in which case the caller should leave the building
 * unresolved (the blocking validator picks it up).
 */
export async function resolveHeatTechAssignment(techKey: string): Promise<ReturnType<typeof fetchOpenTechTechBySlug>> {
  return fetchOpenTechTechBySlug(techKey);
}