/**
 * Invalidator — the cascade as *stale ports* (case T7).
 *
 * Spec: `.local/ModularThesis/spec/core.md` §B. Locks `Plan.md` §5: invalidation is minimal
 * and influence-aware, derived from each module's declared `affect` map.
 *
 * Written failing first.
 */
import { describe, it, expect } from "vitest";
import { changedPorts, stageCascade } from "./invalidator";
import { defineModule } from "./module";
import type { DiffOp } from "./diff";
import type { ModelData } from "./ports";
import { building, fc } from "./fixtures";

const COORDINATES_EDIT: DiffOp = {
  op: "replace",
  path: "/coordinates",
  prev: [],
  next: [[[8.6, 49.4]]],
};

// Expected paths, so the assertions read as ports rather than string soup.
const BUILDINGS = "/buildings";
const TRANSFORMERS = "/transformers";
const BUILDING_PARAMS = "/buildingParams";
const ADVANCED_PARAMS = "/advancedParams";

/** Reads the drawn area, produces the grid. */
const gridGeneration = defineModule({
  id: "grid-generation",
  params: [{ port: "coordinates" }, { port: "buildings" }, { port: "transformers" }, { port: "lines" }],
  affect: { coordinates: ["buildings", "transformers", "lines"] },
  layout: [],
});

/** Reads the grid and edits it — writes a port it also read. */
const areaEdit = defineModule({
  id: "area-edit",
  params: [{ port: "buildings" }, { port: "transformers" }],
  affect: { coordinates: ["buildings", "transformers"] },
  layout: [],
});

/** Downstream of the grid. */
const buildingDemand = defineModule({
  id: "building-demand",
  params: [{ port: "buildings" }, { port: "buildingParams" }],
  affect: { buildings: ["buildingParams"] },
  layout: [],
});

/** Depends on something else entirely. */
const weather = defineModule({
  id: "weather",
  params: [{ port: "weatherSelection" }, { port: "advancedParams" }],
  affect: { weatherSelection: ["advancedParams"] },
  layout: [],
});

function data(overrides: Partial<ModelData> = {}): ModelData {
  return {
    coordinates: [],
    buildings: fc(),
    transformers: fc([building("t1")]),
    advancedParams: { scenario: "season/winter" },
    ...overrides,
  };
}

describe("T7 — the cascade is the affected closure, minus what it cannot touch", () => {
  it("prunes the affected ports that exist and nothing else", () => {
    const cascade = stageCascade({
      changed: ["coordinates"],
      primary: [COORDINATES_EDIT],
      data: data(),
      modules: [gridGeneration],
    });

    // `lines` is declared as affected but is absent from the store — nothing to prune.
    expect(cascade.map((op) => op.path)).toEqual([BUILDINGS, TRANSFORMERS]);
    expect(cascade[0]).toMatchObject({ op: "remove", prev: fc() });
  });

  it("never prunes a port the primary diff already writes", () => {
    const primary: DiffOp[] = [
      COORDINATES_EDIT,
      { op: "replace", path: "/buildings", prev: fc(), next: fc([building("b1")]) },
    ];

    const cascade = stageCascade({
      changed: ["coordinates"],
      primary,
      data: data(),
      modules: [gridGeneration, areaEdit],
    });

    // buildings is superseded by the action itself; transformers is still stale.
    expect(cascade.map((op) => op.path)).toEqual([TRANSFORMERS]);
  });

  it("follows the closure transitively across modules", () => {
    const cascade = stageCascade({
      changed: ["coordinates"],
      primary: [COORDINATES_EDIT],
      data: data({ buildingParams: { electricity: {} } }),
      modules: [gridGeneration, buildingDemand],
    });

    expect(cascade.map((op) => op.path)).toEqual([BUILDINGS, TRANSFORMERS, BUILDING_PARAMS]);
  });

  it("stays inside the declared closure — an unrelated input prunes nothing", () => {
    const cascade = stageCascade({
      changed: ["coordinates"],
      primary: [COORDINATES_EDIT],
      data: data(),
      modules: [gridGeneration, weather],
    });

    expect(cascade.map((op) => op.path)).not.toContain(ADVANCED_PARAMS);
    expect(cascade.map((op) => op.path)).toEqual([BUILDINGS, TRANSFORMERS]);
  });

  it("produces nothing when the change has no affected outputs", () => {
    const cascade = stageCascade({
      changed: ["modelName"],
      primary: [{ op: "replace", path: "/modelName", prev: "a", next: "b" }],
      data: data(),
      modules: [gridGeneration, buildingDemand, weather],
    });

    expect(cascade).toEqual([]);
  });

  it("reports the changed ports of a diff at port granularity", () => {
    expect(
      changedPorts([
        { op: "replace", path: "/buildingParams/electricity", prev: undefined, next: {} },
        COORDINATES_EDIT,
        { op: "replace", path: "/buildingParams/electricity", prev: {}, next: { b1: {} } },
      ]),
    ).toEqual(["buildingParams", "coordinates"]);
  });
});

