/**
 * Folding the store's ports back into the legacy's shape — the outbound half of the port↔feature seam.
 *
 * The store keeps demand and technologies as ports; the legacy keeps them on the building features, in
 * `properties`, and saves `config.buildings` as that same feature collection. `foldBuilding` runs every
 * feature through the fold before the payload goes out, so a legacy consumer reads what it always read;
 * `load/unfold.ts` is the return trip.
 */

import type { BuildingParams, ModelData, TechAssignment } from "@model-builder/core";

/** One feature's properties, as the legacy writes them. Free-form: it is the backend's shape, not ours. */
type LegacyProperties = Record<string, unknown>;

/** The per-class breakdown, in the legacy's spelling. */
function fclassDetails(params: BuildingParams | undefined): LegacyProperties[] {
  return (params?.byClass ?? []).map((entry) => ({
    f_class: entry.fClass,
    demand_energy: entry.yearlyKwh,
    peak_load_kw: entry.peakKw,
  }));
}

/** A technology assignment, in the legacy's shape — keyed by its type, naming the product, carrying its parameters. */
function legacyTechnology(assignment: TechAssignment): LegacyProperties {
  const params = assignment.params ?? {};
  const product = typeof params.product === "string" ? params.product : assignment.techId;
  const constraints = Object.entries(params)
    .filter(([key]) => key !== "product")
    .map(([key, value]) => ({ key, value }));

  return {
    key: assignment.techId,
    product,
    ...(constraints.length > 0 ? { constraints } : {}),
  };
}

/** One building feature with its ports folded back in; returns it unchanged when nothing applies. */
export function foldBuilding(
  feature: GeoJSON.Feature,
  params: Readonly<ModelData>["buildingParams"],
  technologies: Readonly<ModelData>["technologies"],
): GeoJSON.Feature {
  const id = String(feature.properties?.osm_id ?? feature.id ?? "");
  if (id.length === 0) return feature;

  const electricity = params?.electricity?.[id];
  const heat = params?.heat?.[id];
  const techs = technologies?.[id];

  const folded: LegacyProperties = { ...(feature.properties ?? {}) };

  if (electricity !== undefined) {
    // Both names for the same figure: the legacy writes them as it goes, and a consumer may read either.
    if (electricity.yearlyKwh !== undefined) {
      folded.yearly_demand_kwh = electricity.yearlyKwh;
      folded.demand_energy = electricity.yearlyKwh;
    }
    if (electricity.peakKw !== undefined) folded.peak_load_kw = electricity.peakKw;
    if (electricity.fClass !== undefined) folded.selected_f_class = electricity.fClass;
    const details = fclassDetails(electricity);
    if (details.length > 0) folded.fclass_details = details;
  }

  // A mirrored figure is an estimate; a user's own entry is not.
  if (heat !== undefined && heat.yearlyKwh !== undefined) {
    folded.demand_heat = heat.yearlyKwh;
    folded.yearly_heat_demand_kwh = heat.yearlyKwh;
    folded.heat_demand_estimated = heat.source === "mirror";
  }

  if (techs !== undefined && techs.length > 0) {
    folded.technologies = techs.map(legacyTechnology);
  }

  return { ...feature, properties: folded };
}

/** A building feature collection with every feature folded; `undefined` for an absent collection. */
export function foldBuildings(
  buildings: Readonly<ModelData>["buildings"],
  params: Readonly<ModelData>["buildingParams"],
  technologies: Readonly<ModelData>["technologies"],
): GeoJSON.FeatureCollection | undefined {
  if (buildings === undefined) return undefined;
  return {
    type: "FeatureCollection",
    features: buildings.features.map((feature) => foldBuilding(feature, params, technologies)),
  };
}
