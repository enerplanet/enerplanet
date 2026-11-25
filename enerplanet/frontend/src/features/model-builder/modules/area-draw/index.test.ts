/** `area-draw`'s tests: its declaration, its behaviour, the area size, and the data-loss confirmation. */
import { describe, it, expect } from "vitest";
import {
  contractIssues,
  createEngine,
  createStore,
  runInScratch,
  type Coordinates,
  type ModelData,
} from "@model-builder/core";
import areaDraw, { areaGeometry, areaKm2, hold, needsConfirmation } from "./index";

describe("the geometry the map is framed to", () => {
  it("gives every ring its own polygon, which is how this module draws them", () => {
    expect(areaGeometry([RING_A, RING_B])).toEqual({
      type: "MultiPolygon",
      coordinates: [[RING_A], [RING_B]],
    });
  });

  it("has nothing to frame when no area is drawn", () => {
    expect(areaGeometry([])).toBeUndefined();
    expect(areaGeometry(undefined)).toBeUndefined();
  });

  it("leaves out a ring that is not a shape yet, rather than framing a point", () => {
    // The same threshold `validate` reports: a polygon needs three points.
    const notAShape = [RING_A[0], RING_A[1]] as [number, number][];
    expect(areaGeometry([notAShape])).toBeUndefined();
    expect(areaGeometry([notAShape, RING_A])).toEqual({ type: "MultiPolygon", coordinates: [[RING_A]] });
  });
});

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
    // `affect` is empty: the region constrains what may be drawn, and the cascade belongs to the consumers of `coordinates`.
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
    await engine.runModule(areaDraw.module, { id: NODE, moduleId: areaDraw.module.id });

    expect(store.data.coordinates).toEqual(TWO_RINGS);
    expect(store.log).toHaveLength(1);
    expect(store.log[0].primary.map((op) => op.path)).toEqual(["/coordinates"]);
  });

  it("replaces the area rather than appending to it", async () => {
    // A gesture replaces the whole area, not increments it.
    const store = createStore({ region: REGION, coordinates: TWO_RINGS });
    const engine = createEngine(store);

    hold(NODE, { coordinates: ONE_RING });
    await engine.runModule(areaDraw.module, { id: NODE, moduleId: areaDraw.module.id });

    expect(store.data.coordinates).toEqual(ONE_RING);
  });

  it("clears the area, and that is a transaction like any other", async () => {
    const store = createStore({ region: REGION, coordinates: ONE_RING });
    const engine = createEngine(store);

    hold(NODE, { coordinates: [] });
    await engine.runModule(areaDraw.module, { id: NODE, moduleId: areaDraw.module.id });

    expect(store.data.coordinates).toEqual([]);
    expect(store.log).toHaveLength(1);
  });

  it("records the re-apply without changing anything", async () => {
    // Already applied: the run proposes nothing but still seals a zero-diff trace.
    const store = createStore({ region: REGION, coordinates: ONE_RING });
    const engine = createEngine(store);

    hold(NODE, { coordinates: ONE_RING });
    const sealed = await engine.runModule(areaDraw.module, { id: NODE, moduleId: areaDraw.module.id });

    // Sealed, but carrying no ops: the trace is the point, not a diff.
    expect(sealed?.primary).toHaveLength(0);
    expect(store.log).toHaveLength(1);
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
    // Spherical-area check (A = R²·Δλ·(sin φ₂ − sin φ₁)); the tolerance is tight enough to catch the sine/radian mutation.
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
