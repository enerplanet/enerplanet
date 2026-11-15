/**
 * Folding the store's ports back into the legacy's shape (the audit's G2).
 *
 * The store keeps demand and technologies as **ports**; the legacy keeps them **on the building features**, in
 * `properties`, and saves `config.buildings` as that same feature collection. Both are true at once, and this
 * is the seam between them: `model-save` runs every building feature through `foldBuilding` before the payload
 * goes out, so what a legacy consumer reads is what it has always read.
 *
 * **Read off the legacy, not guessed.** Two sources agree, and the second is what makes the key names facts:
 *
 * - `saveAreaData` builds its config with `{ ...pylovoData }` — the whole grid object spread — so
 *   `config.buildings` is the feature collection the map was holding, edits and all.
 * - `configFingerprint` then counts `f.properties.technologies.length`, which only means anything if a
 *   technology assignment is an **array on the feature**.
 *
 * The demand keys come from `useBuildingDemandRecalculation`, which writes them onto the feature as it goes:
 * total and peak under two names each (the legacy writes both), the per-class breakdown as `fclass_details`,
 * and heat with the `heat_demand_estimated` flag that distinguishes a mirror from a user's own entry.
 *
 * **What this deliberately does not do** is invent keys for the fields the store has no port for — the run
 * mode, the cooking carrier, the prices, the site scope (G6). Those belong to modules that do not exist yet,
 * and a fabricated value would be worse than an absent one. `quill.md` records them.
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

/**
 * A technology assignment, in the legacy's shape: keyed by its type, naming the catalogue product, carrying the
 * product's parameters.
 *
 * The vector typing we designed deliberately does **not** travel: the legacy has no notion of it, and adding
 * fields a consumer does not expect is how a payload stops being the shape it claims to be.
 */
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

/**
 * One building feature with its ports folded back in.
 *
 * Returns the feature unchanged when nothing applies, so a model with no demand or technologies saves exactly
 * the grid it was given rather than a copy with empty keys added.
 */
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

  // A mirrored figure is an estimate; a user's own entry is not. That is the whole meaning of the flag.
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

/**
 * A building feature collection with every feature folded.
 *
 * Returns `undefined` for an absent collection rather than an empty one: the legacy omits the key entirely when
 * there was no grid, and an empty collection would claim there was.
 */
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
