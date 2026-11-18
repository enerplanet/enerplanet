/**
 * Unfolding a saved model back into ports — and, most importantly, the round trip.
 *
 * The case that matters most is not any single key: it is that **folding an unfolded config gives the config
 * back**. That is a property, not an example, and it is the only thing that proves the two directions agree —
 * a fold that writes one key and an unfold that reads another would pass every hand-written case and still
 * lose a user's work on the next save.
 *
 * The rest pin what is deliberately *not* recoverable: a technology's `source` is our field and a legacy model
 * has never heard of it.
 */
import { describe, expect, it } from "vitest";
import { unfoldConfig } from "./unfold";
import { foldBuildings } from "../save/fold";

/** A feature as a legacy model serves it: the grid's properties, plus the edits written onto them. */
function savedFeature(osmId: string, props: Record<string, unknown> = {}): GeoJSON.Feature {
  return {
    type: "Feature",
    properties: { osm_id: osmId, building_type: "residential", area_m2: 120, ...props },
    geometry: { type: "Point", coordinates: [8.6, 49.4] },
  };
}

/** A `config` shaped the way the legacy saves one, with a building that has everything folded onto it. */
function savedConfig(): Record<string, unknown> {
  return {
    buildings: {
      type: "FeatureCollection",
      features: [
        savedFeature("b1", {
          yearly_demand_kwh: 12_000,
          demand_energy: 12_000,
          peak_load_kw: 4,
          selected_f_class: "residential",
          fclass_details: [{ f_class: "residential", demand_energy: 12_000, peak_load_kw: 4 }],
          demand_heat: 10_800,
          yearly_heat_demand_kwh: 10_800,
          heat_demand_estimated: true,
          technologies: [
            { key: "gas_boiler", product: "viessmann-200" },
            { key: "pv_supply", product: "pv-400", constraints: [{ key: "kwp", value: 8 }] },
          ],
        }),
        savedFeature("b2", { demand_energy: 6_000, demand_heat: 5_400, heat_demand_estimated: false }),
      ],
    },
    lines: { type: "FeatureCollection", features: [] },
    weatherProvider: "era5-land",
    weatherScenario: "p90",
  };
}

describe("unfolding a saved config", () => {
  it("lifts the demand off the features into its ports", () => {
    const unfolded = unfoldConfig(savedConfig());

    expect(unfolded.buildingParams?.electricity?.b1).toEqual({
      yearlyKwh: 12_000,
      peakKw: 4,
      fClass: "residential",
      byClass: [{ fClass: "residential", yearlyKwh: 12_000, peakKw: 4 }],
      source: "estimate",
    });
    // The legacy's flag maps straight back: an estimated figure is the mirror, a real one is the user's.
    expect(unfolded.buildingParams?.heat?.b1).toMatchObject({ yearlyKwh: 10_800, source: "mirror" });
    expect(unfolded.buildingParams?.heat?.b2).toMatchObject({ yearlyKwh: 5_400, source: "user" });
  });

  it("lifts the technologies out, naming their catalogue product", () => {
    const unfolded = unfoldConfig(savedConfig());

    expect(unfolded.technologies?.b1).toEqual([
      { techId: "gas_boiler", params: { product: "viessmann-200" }, source: "catalogue" },
      { techId: "pv_supply", params: { product: "pv-400", kwp: 8 }, source: "catalogue" },
    ]);
    // `source` is ours, not the legacy's — a loaded assignment says where it came from, honestly.
    expect(unfolded.technologies?.b1?.[0]?.source).toBe("catalogue");
  });

  it("keeps the whole feature collection on the buildings port", () => {
    const unfolded = unfoldConfig(savedConfig());

    // The extra properties a legacy feature carries must survive: dropping them would lose data the next save
    // would then not write back.
    expect(unfolded.buildings?.features).toHaveLength(2);
    expect(unfolded.buildings?.features[0]?.properties?.area_m2).toBe(120);
  });

  it("reads the weather back from its three keys", () => {
    expect(unfoldConfig(savedConfig()).weatherSelection).toEqual({
      provider: "era5-land",
      choice: "p90",
    });
    expect(unfoldConfig({ weatherYear: 2019 }).weatherSelection).toEqual({
      provider: null,
      choice: "year",
      year: 2019,
    });
  });

  it("says nothing about what the model never chose", () => {
    // Absent is absent: fabricating the default here would make a load look like a decision somebody made.
    expect(unfoldConfig({ buildings: { type: "FeatureCollection", features: [] } }).weatherSelection).toBeUndefined();
    expect(unfoldConfig(undefined)).toEqual({});
    expect(unfoldConfig(null)).toEqual({});
  });

  it("says nothing about demand a model never had", () => {
    const bare = unfoldConfig({
      buildings: { type: "FeatureCollection", features: [savedFeature("b1")] },
    });

    expect(bare.buildingParams).toBeUndefined();
    expect(bare.technologies).toBeUndefined();
    // …but the buildings still come through: there *is* a grid, it just has no demand yet.
    expect(bare.buildings?.features).toHaveLength(1);
  });

  it("round-trips: folding an unfolded config gives the config's buildings back", () => {
    // The property that makes the two directions trustworthy, and the reason both live behind one test file
    // pair: the fold writes these keys and the unfold reads them, so any disagreement shows up here rather
    // than as a user's work quietly disappearing on the next save.
    const config = savedConfig();
    const unfolded = unfoldConfig(config);

    const refolded = foldBuildings(
      unfolded.buildings,
      unfolded.buildingParams,
      unfolded.technologies,
    );

    const original = (config.buildings as GeoJSON.FeatureCollection).features;
    const written = refolded?.features ?? [];

    expect(written).toHaveLength(original.length);
    for (const [index, feature] of written.entries()) {
      expect(feature.properties).toMatchObject(original[index].properties as Record<string, unknown>);
    }
  });
});
