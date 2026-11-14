/**
 * `area-draw`'s tests.
 *
 * Written failing first.
 *
 * The declaration cases pin what this module *is*: it requires the region (an area is drawn inside one) and
 * produces `coordinates`, and nothing feeds it — so `affect` is empty and the cascade the spec describes
 * belongs to the modules that *consume* `coordinates`, not to this one.
 *
 * The behaviour cases pin the two decisions worth arguing about: a gesture **replaces** the area (the module's
 * UI owns the draft, so what it hands over is the whole area, not an increment), and the two pure helpers the
 * sidebar and the data-loss confirmation are built on.
 */
import { describe, it, expect } from "vitest";
import {
  contractIssues,
  createEngine,
  createStore,
  runInScratch,
  type Coordinates,
  type ModelData,
} from "@model-builder/core";
import areaDraw, { areaKm2, hold, needsConfirmation } from "./index";

/** The node these cases run as — the module's own id, which is what a host uses in test mode. */
const NODE = areaDraw.module.id;

/** A region chosen in `model-start`; an area is drawn inside one. */
const REGION = { country: "DE", state: "BW" };

/** Karlsruhe-ish, two square rings of ~0.01° — small on purpose, so the area stays readable. */
const RING_A: [number, number][] = [
  [8.50, 49.30],
  [8.51, 49.30],
  [8.51, 49.31],
  [8.50, 49.31],
  [8.50, 49.30],
];
const RING_B: [number, number][] = [
  [8.60, 49.30],
  [8.61, 49.30],
  [8.61, 49.31],
  [8.60, 49.31],
  [8.60, 49.30],
];
const ONE_RING: Coordinates = [RING_A];
const TWO_RINGS: Coordinates = [RING_A, RING_B];

/** A store carrying the little a downstream step wrote — enough to make applying an area destructive. */
const WITH_GRID: Partial<ModelData> = {
  region: REGION,
  coordinates: ONE_RING,
  buildings: { type: "FeatureCollection", features: [] },
};

describe("area-draw's declaration", () => {
  it("is consistent with the contract", () => {
    expect(contractIssues(areaDraw)).toEqual([]);
  });

  it("requires the region — an area is drawn inside one — and produces coordinates", () => {
    const required = areaDraw.module.params.filter((param) => param.required === true).map((p) => p.port);
    const declared = areaDraw.module.params.map((param) => param.port);

    expect(required).toEqual(["region"]);
    // `coordinates` is what it *produces*: requiring it would be requiring its own output.
    expect([...declared].sort()).toEqual(["coordinates", "region"]);
  });

  it("declares no influence, because nothing feeds it", () => {
    // `affect` maps a module's *inputs* to the outputs they change. The region constrains what may be drawn,
    // it does not change what this module writes — the user redraws. The invalidation the spec describes
    // (`coordinates` → the whole grid) is declared by the modules that consume `coordinates`, through the
    // cascade, not here.
    expect(areaDraw.module.affect).toEqual({});
  });

  it("presents the two regions it actually uses", () => {
    expect([...areaDraw.module.layout].sort()).toEqual(["map", "sidebar"]);
  });

  it("seals one transaction per gesture", () => {
    // A confirmed area is atomic: the whole ring list lands together or not at all.
    expect(areaDraw.module.seal).toBe("per-commit");
  });
});

describe("area-draw's behaviour", () => {
  it("commits the whole area in one transaction", async () => {
    const store = createStore({ region: REGION });
    const engine = createEngine(store);

    hold(NODE, { coordinates: TWO_RINGS });
    await engine.runModule(areaDraw.module, { id: NODE });

    expect(store.data.coordinates).toEqual(TWO_RINGS);
    expect(store.log).toHaveLength(1);
    expect(store.log[0].primary.map((op) => op.path)).toEqual(["/coordinates"]);
  });

  it("replaces the area rather than appending to it", async () => {
    // The module's UI owns the draft, so what it hands over is the *whole* area. An append here would make a
    // UI that hands the full list (the only sensible one) silently double every ring.
    const store = createStore({ region: REGION, coordinates: TWO_RINGS });
    const engine = createEngine(store);

    hold(NODE, { coordinates: ONE_RING });
    await engine.runModule(areaDraw.module, { id: NODE });

    expect(store.data.coordinates).toEqual(ONE_RING);
  });

  it("clears the area, and that is a transaction like any other", async () => {
    const store = createStore({ region: REGION, coordinates: ONE_RING });
    const engine = createEngine(store);

    hold(NODE, { coordinates: [] });
    await engine.runModule(areaDraw.module, { id: NODE });

    expect(store.data.coordinates).toEqual([]);
    expect(store.log).toHaveLength(1);
  });

  it("seals nothing when the same area is applied again", async () => {
    const store = createStore({ region: REGION, coordinates: ONE_RING });
    const engine = createEngine(store);

    hold(NODE, { coordinates: ONE_RING });
    await expect(engine.runModule(areaDraw.module, { id: NODE })).resolves.toBeUndefined();

    expect(store.log).toHaveLength(0);
  });

  it("reports what is missing on an empty store — an area needs somewhere to be, and something to be", async () => {
    const { issues } = await runInScratch({ module: areaDraw.module });

    expect(issues.map((issue) => issue.port).sort()).toEqual(["coordinates", "region"]);
  });

  it("refuses an area whose ring cannot enclose anything", async () => {
    const { issues } = await runInScratch({
      module: areaDraw.module,
      // Two points is a line, not an area.
      mock: { region: REGION, coordinates: [[[8.5, 49.3], [8.6, 49.3]] as [number, number][]] },
    });

    expect(issues).toEqual([{ port: "coordinates", message: "A polygon needs at least three points." }]);
  });

  it("accepts a drawn area", async () => {
    const { issues } = await runInScratch({
      module: areaDraw.module,
      mock: { region: REGION, coordinates: TWO_RINGS },
    });

    expect(issues).toEqual([]);
  });
});

describe("the area's size", () => {
  it("measures a one-degree cell at the equator the way the sphere does", () => {
    // Derived, not remembered: for a lat/lon rectangle A = R²·Δλ·(sin φ₂ − sin φ₁). With R = 6371.0088 km and
    // Δλ = 1° = 0.0174533 rad: 6371.0088² × 0.0174533 × sin(1°) = 12,363.718 km².
    //
    // The tolerance is deliberately tight. A planar shoelace over degrees gives 12,366.6 (wrong by ~3 km²), but
    // *replacing only the sine with radians* — the subtler mutation — moves this answer by 0.6 km², and a window
    // of ±1 km² would let it through without ever noticing. The case is worth exactly as much as its precision.
    const cell: Coordinates = [
      [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
        [0, 0],
      ],
    ];

    expect(areaKm2(cell)).toBeCloseTo(12363.718, 1);
  });

  it("sums the rings, because the model is all of them", () => {
    expect(areaKm2(TWO_RINGS)).toBeCloseTo(areaKm2(ONE_RING) * 2, 1);
  });

  it("is zero for no area at all", () => {
    expect(areaKm2([])).toBe(0);
    expect(areaKm2([[]])).toBe(0);
  });

  it("does not care which way round a ring is wound", () => {
    const clockwise: Coordinates = [[...RING_A].reverse()];

    expect(areaKm2(clockwise)).toBeCloseTo(areaKm2(ONE_RING), 6);
  });
});

describe("the data-loss confirmation", () => {
  it("is asked for when downstream work exists and the area changed", () => {
    expect(needsConfirmation(WITH_GRID, TWO_RINGS)).toBe(true);
  });

  it("is not asked for when nothing downstream would be lost", () => {
    const empty: Partial<ModelData> = { region: REGION };

    expect(needsConfirmation(empty, TWO_RINGS)).toBe(false);
  });

  it("is not asked for when the area is the one already applied", () => {
    // Re-applying what is already there destroys nothing, so a confirmation there would be crying wolf.
    expect(needsConfirmation(WITH_GRID, ONE_RING)).toBe(false);
  });

  it("is not asked for when the user is only clearing what is not applied anyway", () => {
    const noArea: Partial<ModelData> = { ...WITH_GRID, coordinates: [] };

    expect(needsConfirmation(noArea, [])).toBe(false);
  });
});
