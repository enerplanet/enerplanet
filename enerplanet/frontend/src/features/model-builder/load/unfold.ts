/**
 * Unfolding a saved model back into the store's ports — the inverse of `save/fold.ts`.
 *
 * A legacy model's `config` keeps demand and technologies **on its building features**; our store keeps them
 * as ports. `fold.ts` is the outbound direction and this is the return trip, so a model saved by the legacy —
 * or by us — loads into a session that can be edited and saved again.
 *
 * **It is a real inverse, and the ways it is not are worth naming.**
 *
 * - **`source` on a technology is not recoverable.** The legacy has no such field; it is ours, invented so an
 *   autoplaced estimate could be told from a deliberate choice. A loaded assignment gets `"catalogue"`, which
 *   is the honest reading: it came from the catalogue, and nobody in this session placed it.
 * - **Extra properties are kept.** A legacy feature carries far more than the keys we fold — areas, storeys,
 *   geometry-derived facts — and dropping them would lose data the next save would then not write back. They
 *   ride along on the `buildings` port, and the fold leaves them untouched.
 * - **Absent means absent.** A model with no `weatherScenario` gets no `weatherSelection` rather than a
 *   fabricated default; the weather module owns defaults, and inventing one here would make a load look like a
 *   choice somebody made.
 *
 * `config.buildings` is still the `buildings` port: the same collection, minus nothing. The demand and
 * technology keys are *additionally* lifted out into their ports, which is the whole point — the store's
 * modules read ports, and the fold puts them back when the model is saved again.
 */

import type { BuildingParams, ClassDemand, EnergyVector, ModelData, TechAssignment } from "@model-builder/core";

/** The two vectors this project ships; a model may carry others, but only these have legacy keys we know. */
const ELECTRICITY = "electricity";
const HEAT = "heat";

/** A number from an untrusted property, or undefined. */
function numberOf(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** A string from an untrusted property, or undefined. */
function stringOf(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

/** The id a feature is keyed by — `osm_id` first, then the GeoJSON id. */
function idOf(feature: GeoJSON.Feature): string | undefined {
  const id = feature.properties?.osm_id ?? feature.id;
  if (typeof id === "number") return String(id);
  return stringOf(id);
}

/** The per-class breakdown, back from the legacy's spelling. */
function byClassOf(value: unknown): ClassDemand[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const classes = value
    .map((entry) => {
      const record = (entry ?? {}) as Record<string, unknown>;
      const fClass = stringOf(record.f_class) ?? stringOf(record.fClass);
      if (fClass === undefined) return undefined;
      return {
        fClass,
        yearlyKwh: numberOf(record.demand_energy) ?? numberOf(record.yearlyKwh) ?? 0,
        peakKw: numberOf(record.peak_load_kw) ?? numberOf(record.peakKw) ?? 0,
      };
    })
    .filter((entry): entry is ClassDemand => entry !== undefined);
  return classes.length > 0 ? classes : undefined;
}

/**
 * A technology assignment, back from the legacy's shape.
 *
 * The legacy's `key` is the *type*, which is what our `techId` holds; its `product` names the catalogue entry
 * and becomes a parameter. The vectors are ours and are not on the wire, so nothing is recovered for them —
 * the catalogue knows, and a module that needs them asks it.
 */
function unfoldTechnology(value: unknown): TechAssignment | undefined {
  const record = (value ?? {}) as Record<string, unknown>;
  const techId = stringOf(record.key) ?? stringOf(record.techId);
  if (techId === undefined) return undefined;

  const product = stringOf(record.product);
  const constraints = Array.isArray(record.constraints)
    ? Object.fromEntries(
        record.constraints
          .map((c) => (c ?? {}) as Record<string, unknown>)
          .filter((c) => stringOf(c.key) !== undefined)
          .map((c) => [c.key as string, c.value]),
      )
    : {};

  const params: Record<string, unknown> = {
    ...(product === undefined ? {} : { product }),
    ...constraints,
  };

  return {
    techId,
    ...(Object.keys(params).length === 0 ? {} : { params }),
    // Not recoverable from a legacy model: `source` is our field. The catalogue is where it came from.
    source: "catalogue",
  };
}

/** One building's demand, lifted off its feature. */
function paramsOf(properties: Record<string, unknown>): { electricity?: BuildingParams; heat?: BuildingParams } {
  const electricity: BuildingParams = {};
  const heat: BuildingParams = {};

  const yearly = numberOf(properties.yearly_demand_kwh) ?? numberOf(properties.demand_energy);
  const peak = numberOf(properties.peak_load_kw);
  const fClass = stringOf(properties.selected_f_class) ?? stringOf(properties.f_class);
  const byClass = byClassOf(properties.fclass_details);

  if (yearly !== undefined) electricity.yearlyKwh = yearly;
  if (peak !== undefined) electricity.peakKw = peak;
  if (fClass !== undefined) electricity.fClass = fClass;
  if (byClass !== undefined) electricity.byClass = byClass;
  if (Object.keys(electricity).length > 0) electricity.source = "estimate";

  const heatKwh = numberOf(properties.demand_heat) ?? numberOf(properties.yearly_heat_demand_kwh);
  if (heatKwh !== undefined) {
    heat.yearlyKwh = heatKwh;
    if (fClass !== undefined) heat.fClass = fClass;
    // The flag is the legacy's own way of saying where the number came from, so it maps straight back.
    heat.source = properties.heat_demand_estimated === true ? "mirror" : "user";
  }

  return {
    ...(Object.keys(electricity).length === 0 ? {} : { electricity }),
    ...(Object.keys(heat).length === 0 ? {} : { heat }),
  };
}

export interface UnfoldedConfig {
  buildings?: GeoJSON.FeatureCollection;
  buildingParams?: Partial<Record<EnergyVector, Record<string, BuildingParams>>>;
  technologies?: Record<string, TechAssignment[]>;
  weatherSelection?: ModelData["weatherSelection"];
}

/** The demand and technologies a config's buildings describe, keyed by id. */
function buildingsOf(config: Record<string, unknown>): UnfoldedConfig {
  const buildings = config.buildings as GeoJSON.FeatureCollection | undefined;
  if (buildings === undefined || !Array.isArray(buildings.features)) return {};

  const electricity: Record<string, BuildingParams> = {};
  const heat: Record<string, BuildingParams> = {};
  const technologies: Record<string, TechAssignment[]> = {};

  for (const feature of buildings.features) {
    const id = idOf(feature);
    if (id === undefined) continue;

    const properties = (feature.properties ?? {}) as Record<string, unknown>;
    const { electricity: power, heat: warmth } = paramsOf(properties);
    if (power !== undefined) electricity[id] = power;
    if (warmth !== undefined) heat[id] = warmth;

    const assignments = Array.isArray(properties.technologies)
      ? properties.technologies
          .map(unfoldTechnology)
          .filter((entry): entry is TechAssignment => entry !== undefined)
      : [];
    if (assignments.length > 0) technologies[id] = assignments;
  }

  const anyParams = Object.keys(electricity).length > 0 || Object.keys(heat).length > 0;

  return {
    buildings,
    ...(anyParams
      ? {
          buildingParams: {
            ...(Object.keys(electricity).length === 0 ? {} : { [ELECTRICITY]: electricity }),
            ...(Object.keys(heat).length === 0 ? {} : { [HEAT]: heat }),
          },
        }
      : {}),
    ...(Object.keys(technologies).length === 0 ? {} : { technologies }),
  };
}

/**
 * The weather, back from its three keys.
 *
 * A recorded year wins, exactly as it does on the way out. Absent keys mean the model chose nothing, which is
 * not the same as choosing the default — so nothing is fabricated here.
 */
function weatherOf(config: Record<string, unknown>): Pick<UnfoldedConfig, "weatherSelection"> {
  const provider = stringOf(config.weatherProvider) ?? null;
  const year = numberOf(config.weatherYear);
  const scenario = stringOf(config.weatherScenario);
  if (provider === null && year === undefined && scenario === undefined) return {};

  if (year !== undefined) return { weatherSelection: { provider, choice: "year", year } };
  if (scenario === "p10" || scenario === "p50" || scenario === "p90") {
    return { weatherSelection: { provider, choice: scenario } };
  }
  return { weatherSelection: { provider, choice: "p50" } };
}

/**
 * The demand, technologies and weather a saved `config` describes.
 *
 * The grid collections other than buildings are left to the caller: `buildings` comes back here because this
 * function has to walk it anyway, but a line has nothing to unfold.
 */
export function unfoldConfig(config: Record<string, unknown> | null | undefined): UnfoldedConfig {
  if (config === null || config === undefined) return {};
  return { ...buildingsOf(config), ...weatherOf(config) };
}
