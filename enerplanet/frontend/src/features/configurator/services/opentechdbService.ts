// ---------------------------------------------------------------------------
// OpenTech-DB → legacy Technology bridge (configurator integration).
// Fetches heat techs through the backend proxy and maps them onto the legacy
// Technology shape so both lists flow through one assignment path.
//
// Discriminator: assigned techs carry `source: "opentechdb"`; simulator techs
// (the 8 DB-table techs) keep no source field (they are the default). Capacity
// fixity lives in constraints, never in a mode flag.
// ---------------------------------------------------------------------------

import api from "@/lib/axios";
import type { Technology, TechnologyConstraint } from "@/features/technologies/services/technologyService";

/** An OpenTech-DB tech extended with bridge metadata for the configurator. */
export interface OtdbBridgeTechnology extends Technology {
  /** Marks this tech as OpenTech-DB-sourced (simulator techs have none). */
  source: "opentechdb";
  /** Output carrier (e.g. "heat") — gates heat assignment. */
  carrierOut: string;
  /** OpenTech-DB category: supply / storage / conversion / transmission. */
  otdbCategory: string;
  /** OpenTech-DB UUID for detail/instance lookups. */
  otdbId: string;
}

interface OtdbTechListItem {
  id: string;
  slug: string;
  name: string;
  category: string;
  input_carriers: string[];
  output_carriers: string[];
  n_instances?: number;
}

const OTDB_SOURCE_KEY = "otdb_source";
const OTDB_ID_KEY = "otdb_id";
const OTDB_CARRIER_OUT_KEY = "otdb_carrier_out";

/**
 * Map one OpenTech-DB list item to the legacy Technology shape.
 * Constraints are intentionally minimal: capacity bounds + lifetime, plus
 * provenance entries (source / otdb id / carrier out) so the webservice can
 * route the assignment later without extra fields on the wire.
 */
function mapToListTechnology(item: OtdbTechListItem): OtdbBridgeTechnology {
  return {
    key: item.slug,
    alias: item.name,
    icon: iconForSlug(item.slug),
    description: `${item.name} (OpenTech-DB, ${item.category})`,
    constraints: buildConstraints(item.id, item.output_carriers[0] ?? ""),
    source: "opentechdb",
    carrierOut: item.output_carriers[0] ?? "",
    otdbCategory: item.category,
    otdbId: item.id,
  };
}

type TechnologyConstraintLite = TechnologyConstraint;

function buildConstraints(otdbId: string, carrierOut: string): TechnologyConstraintLite[] {
  return [
    {
      key: "cont_energy_cap_max",
      alias: "Maximum installed energy capacity",
      default_value: "INF",
      unit: "kW",
      min: null,
      max: null,
    },
    {
      key: "cont_energy_cap_min",
      alias: "Minimum installed energy capacity",
      default_value: 0,
      unit: "kW",
      min: null,
      max: null,
    },
    {
      key: "cont_lifetime",
      alias: "Technology lifetime",
      default_value: 20,
      unit: "years",
      min: null,
      max: null,
    },
    {
      key: OTDB_SOURCE_KEY,
      alias: "Technology source",
      default_value: "opentechdb",
      unit: "",
      min: null,
      max: null,
    },
    {
      key: OTDB_ID_KEY,
      alias: "OpenTech-DB id",
      default_value: otdbId,
      unit: "",
      min: null,
      max: null,
    },
    {
      key: OTDB_CARRIER_OUT_KEY,
      alias: "Output carrier",
      default_value: carrierOut,
      unit: "",
      min: null,
      max: null,
    },
  ];
}

function iconForSlug(slug: string): string {
  if (slug.includes("heat_pump")) return "flame";
  if (slug.includes("boiler")) return "flame";
  if (slug.includes("chp")) return "zap";
  if (slug.includes("storage")) return "battery";
  if (slug.includes("solar")) return "sun";
  if (slug.includes("wind")) return "wind";
  return "circuit-board";
}

let catalogCache: OtdbBridgeTechnology[] | null = null;

/** Offline fallback (same slugs as the live catalog, minimal params). */
const FALLBACK_CATALOG: OtdbTechListItem[] = [
  // heat (conversion/storage)
  { id: "local-air_source_heat_pump", slug: "air_source_heat_pump", name: "Air-Source Heat Pump", category: "conversion", input_carriers: ["electricity"], output_carriers: ["heat"] },
  { id: "local-ground_source_heat_pump", slug: "ground_source_heat_pump", name: "Ground-Source Heat Pump", category: "conversion", input_carriers: ["electricity"], output_carriers: ["heat"] },
  { id: "local-electric_boilers", slug: "electric_boilers", name: "Electric Boilers", category: "conversion", input_carriers: ["electricity"], output_carriers: ["heat"] },
  { id: "local-gas_boiler", slug: "gas_boiler", name: "Gas Boiler", category: "conversion", input_carriers: ["natural_gas"], output_carriers: ["heat"] },
  { id: "local-chp_gas", slug: "chp_gas", name: "Combined Heat and Power (CHP)", category: "conversion", input_carriers: ["natural_gas"], output_carriers: ["electricity", "heat"] },
  { id: "local-biomass_chp", slug: "biomass_chp", name: "Biomass CHP", category: "conversion", input_carriers: ["biomass"], output_carriers: ["electricity", "heat"] },
  { id: "local-sensible_thermal_storage", slug: "sensible_thermal_storage", name: "Sensible Thermal Storage", category: "storage", input_carriers: ["heat"], output_carriers: ["heat"] },
  { id: "local-latent_thermal_storage", slug: "latent_thermal_storage", name: "Latent Thermal Storage", category: "storage", input_carriers: ["heat"], output_carriers: ["heat"] },
  // electricity (generation/storage)
  { id: "local-solar_pv_distributed", slug: "solar_pv_distributed", name: "Solar PV Distributed", category: "generation", input_carriers: ["solar_irradiance"], output_carriers: ["electricity"] },
  { id: "local-solar_pv_utility", slug: "solar_pv_utility", name: "Solar PV Utility-scale", category: "generation", input_carriers: ["solar_irradiance"], output_carriers: ["electricity"] },
  { id: "local-onshore_wind", slug: "onshore_wind", name: "Onshore Wind", category: "generation", input_carriers: ["wind"], output_carriers: ["electricity"] },
  { id: "local-lithium_ion_bess", slug: "lithium_ion_bess", name: "Lithium-ion BESS", category: "storage", input_carriers: ["electricity"], output_carriers: ["electricity"] },
];

/**
 * Fetch the OpenTech-DB catalog (all carriers) through the backend proxy and
 * cache it. Falls back to a static list when the proxy is unreachable so the
 * picker still works offline.
 */
async function fetchOpenTechCatalog(): Promise<void> {
  if (catalogCache) return;

  try {
    const resp = await api.get<{
      total: number;
      technologies: OtdbTechListItem[];
    }>("/opentech-db/technologies?limit=100");
    const items = resp.data?.technologies ?? [];
    if (items.length > 0) {
      catalogCache = items.map(mapToListTechnology);
      return;
    }
  } catch (err) {
    console.warn("[opentechdb] tech fetch failed, using fallback:", err);
  }

  catalogCache = FALLBACK_CATALOG.map(mapToListTechnology);
}

/** All OpenTech-DB technologies with `carrier_out === heat`. */
export async function fetchOpenTechHeatTechnologies(): Promise<OtdbBridgeTechnology[]> {
  await fetchOpenTechCatalog();
  const heat = (catalogCache ?? []).filter((t) => t.carrierOut === "heat");
  return heat.length > 0 ? heat : FALLBACK_CATALOG.filter((t) => (t.output_carriers ?? []).includes("heat")).map(mapToListTechnology);
}

/** All OpenTech-DB technologies with `carrier_out === electricity` (not heat-also). */
export async function fetchOpenTechElectricityTechnologies(): Promise<OtdbBridgeTechnology[]> {
  await fetchOpenTechCatalog();
  return (catalogCache ?? []).filter(
    (t) => t.carrierOut === "electricity"
  );
}

/** True when an assigned tech's constraint payload marks it OpenTech-DB. */
export function isOpentechAssignment(techs: Record<string, { constraints?: { key: string; value: unknown }[] }>): boolean {
  return Object.values(techs).some((t) =>
    (t.constraints ?? []).some((c) => c.key === OTDB_SOURCE_KEY)
  );
}