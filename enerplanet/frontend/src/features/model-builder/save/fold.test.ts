/**
 * Folding the ports back into the legacy's shape — the audit's G2, pinned.
 *
 * The strongest case here is not any single key: it is that a technology assignment ends up as an **array on
 * the feature**, because that is what the legacy's `configFingerprint` counts
 * (`f.properties.technologies.length`). If the fold put it anywhere else, the legacy's own change detection
 * would silently read zero technologies, and a model would save as "unchanged" when it had not been.
 *
 * The demand keys are the second half: the legacy writes each figure under two names as it goes, and heat
 * carries the `heat_demand_estimated` flag whose whole purpose is to tell a mirror apart from a user's entry.
 */
import { describe, expect, it } from "vitest";
import { foldBuilding, foldBuildings } from "./fold";
import { buildSaveConfig } from "./saveModel";
import type { BuildingParams, ModelData, TechAssignment } from "@model-builder/core";

/** A building feature as the grid writes them. */
function building(osmId: string, props: Record<string, unknown> = {}): GeoJSON.Feature {
  return {
    type: "Feature",
    properties: { osm_id: osmId, building_type: "residential", area_m2: 120, ...props },
    geometry: { type: "Point", coordinates: [8.6, 49.4] },
  };
}

const ELECTRICITY: BuildingParams = {
  fClass: "residential",
  yearlyKwh: 12_000,
  peakKw: 4,
  byClass: [{ fClass: "residential", yearlyKwh: 12_000, peakKw: 4 }],
  source: "estimate",
};

const HEAT_MIRROR: BuildingParams = {
  fClass: "residential",
  yearlyKwh: 10_800,
  peakKw: 0,
  source: "mirror",
};

const HEAT_OWN: BuildingParams = { ...HEAT_MIRROR, source: "user" };

/** The props the fold produced for one feature. */
function propsOf(feature: GeoJSON.Feature): Record<string, unknown> {
  return (feature.properties ?? {}) as Record<string, unknown>;
}

describe("folding one building", () => {
  it("writes the demand under both of the legacy's names, and the breakdown it expects", () => {
    const folded = foldBuilding(building("b1"), { electricity: { b1: ELECTRICITY } }, undefined);

    expect(propsOf(folded)).toMatchObject({
      yearly_demand_kwh: 12_000,
      demand_energy: 12_000,
      peak_load_kw: 4,
      selected_f_class: "residential",
      fclass_details: [{ f_class: "residential", demand_energy: 12_000, peak_load_kw: 4 }],
    });
  });

  it("flags a mirrored heat figure as estimated, and a user's own value as not", () => {
    const mirrored = foldBuilding(building("b1"), { heat: { b1: HEAT_MIRROR } }, undefined);
    const own = foldBuilding(building("b1"), { heat: { b1: HEAT_OWN } }, undefined);

    expect(propsOf(mirrored)).toMatchObject({
      demand_heat: 10_800,
      yearly_heat_demand_kwh: 10_800,
      heat_demand_estimated: true,
    });
    // The flag is the whole point of `source` on the port: a value the user typed is not an estimate.
    expect(propsOf(own).heat_demand_estimated).toBe(false);
  });

  it("puts technologies on the feature as an array — what the legacy's fingerprint counts", () => {
    const techs: TechAssignment[] = [
      { techId: "air_source_heat_pump", inputVector: "electricity", outputVector: "heat", source: "estimated" },
      { techId: "pv_supply", outputVector: "electricity", params: { product: "pv-400", kwp: 8 }, source: "user" },
    ];

    const folded = foldBuilding(building("b1"), undefined, { b1: techs });
    const written = propsOf(folded).technologies as Record<string, unknown>[];

    expect(Array.isArray(written)).toBe(true);
    expect(written).toHaveLength(2);
    // The legacy's own shape: keyed by type, naming the product, carrying the parameters.
    expect(written[0]).toEqual({ key: "air_source_heat_pump", product: "air_source_heat_pump" });
    expect(written[1]).toEqual({
      key: "pv_supply",
      product: "pv-400",
      constraints: [{ key: "kwp", value: 8 }],
    });
    // The vector typing deliberately does not travel: the legacy has no notion of it, and a field a consumer
    // does not expect is how a payload stops being the shape it claims to be.
    expect(written[0]).not.toHaveProperty("outputVector");
  });

  it("leaves a building with nothing to fold exactly as it was", () => {
    const original = building("b1", { custom: "kept" });
    const folded = foldBuilding(original, { electricity: {} }, {});

    expect(propsOf(folded)).toEqual(propsOf(original));
  });

  it("leaves a feature with no id alone rather than keying it on nothing", () => {
    const anonymous: GeoJSON.Feature = {
      type: "Feature",
      properties: {},
      geometry: { type: "Point", coordinates: [0, 0] },
    };

    expect(foldBuilding(anonymous, { electricity: { "": ELECTRICITY } }, undefined)).toBe(anonymous);
  });

  it("folds every feature, and omits the collection when there was no grid", () => {
    const collection: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: [building("b1"), building("b2")],
    };

    const folded = foldBuildings(collection, { electricity: { b1: ELECTRICITY } }, undefined);

    expect(folded?.features).toHaveLength(2);
    expect(propsOf(folded!.features[0]).yearly_demand_kwh).toBe(12_000);
    expect(propsOf(folded!.features[1]).yearly_demand_kwh).toBeUndefined();
    // Absent rather than empty: an empty collection would claim there was a grid.
    expect(foldBuildings(undefined, undefined, undefined)).toBeUndefined();
  });
});

describe("the config the fold feeds", () => {
  it("folds the buildings it puts in config.buildings, rather than passing the port's collection through", () => {
    const data: Partial<ModelData> = {
      buildings: { type: "FeatureCollection", features: [building("b1")] },
      buildingParams: { electricity: { b1: ELECTRICITY }, heat: { b1: HEAT_MIRROR } },
      technologies: { b1: [{ techId: "pv_supply", outputVector: "electricity" }] },
    };

    const config = buildSaveConfig(data as ModelData);
    const features = (config.buildings as GeoJSON.FeatureCollection).features;

    expect(propsOf(features[0])).toMatchObject({
      yearly_demand_kwh: 12_000,
      heat_demand_estimated: true,
    });
    expect((propsOf(features[0]).technologies as unknown[]).length).toBe(1);
  });

  it("writes the weather in the legacy's three keys", () => {
    const scenario = buildSaveConfig({
      weatherSelection: { provider: "era5-land", choice: "p90" },
    } as ModelData);
    expect(scenario).toMatchObject({ weatherProvider: "era5-land", weatherScenario: "p90" });
    expect(scenario).not.toHaveProperty("weatherYear");

    // A recorded year wins over a scenario, and the default archive is omitted rather than named.
    const year = buildSaveConfig({
      weatherSelection: { provider: null, choice: "year", year: 2025 },
    } as ModelData);
    expect(year).toMatchObject({ weatherYear: 2025 });
    expect(year).not.toHaveProperty("weatherScenario");
    expect(year).not.toHaveProperty("weatherProvider");
  });
});
