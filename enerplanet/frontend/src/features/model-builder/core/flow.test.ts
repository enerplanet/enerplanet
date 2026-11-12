/**
 * Flow gating — the palette and the validator (cases T10, T11).
 *
 * Spec: `.local/ModularThesis/spec/core.md` §D. Locks `Plan.md` §7: a module is placeable iff
 * every one of its `required` ports already exists, so a build can only ever produce a workflow
 * that runs, and the builder and the validator are the same predicate.
 *
 * Written failing first.
 */
import { describe, it, expect } from "vitest";
import {
  availablePorts,
  isValidFlow,
  missingPorts,
  palette,
  placementReport,
  type Flow,
  type FlowNode,
  type ModuleRegistry,
} from "./flow";
import { defineModule } from "./module";
import type { PortKey } from "./ports";

// ── port names ──────────────────────────────────────────────────────────────
// Constants rather than literals: a typo becomes a compile error, and the fixtures read as data.

const MODEL_NAME: PortKey = "modelName";
const RESOLUTION: PortKey = "resolution";
const REGION: PortKey = "region";
const COORDINATES: PortKey = "coordinates";
const BUILDINGS: PortKey = "buildings";
const TRANSFORMERS: PortKey = "transformers";
const LINES: PortKey = "lines";
const WEATHER_SELECTION: PortKey = "weatherSelection";
const BUILDING_PARAMS: PortKey = "buildingParams";
const SAVE_RESULT: PortKey = "saveResult";

// ── a small but faithful registry ───────────────────────────────────────────

const modelStart = defineModule({
  id: "model-start",
  params: [
    { port: MODEL_NAME },
    { port: "fromDate" },
    { port: "toDate" },
    { port: RESOLUTION },
    { port: REGION },
  ],
  affect: {},
  layout: ["sidebar"],
});

const areaDraw = defineModule({
  id: "area-draw",
  params: [{ port: REGION, required: true }, { port: COORDINATES }],
  affect: { region: [COORDINATES] },
  layout: ["map", "sidebar"],
});

const gridGeneration = defineModule({
  id: "grid-generation",
  params: [
    { port: COORDINATES, required: true },
    { port: BUILDINGS },
    { port: TRANSFORMERS },
    { port: LINES },
  ],
  affect: { coordinates: [BUILDINGS, TRANSFORMERS, LINES] },
  layout: [],
});

const buildingDemand = defineModule({
  id: "building-demand",
  params: [
    { port: BUILDINGS, required: true },
    { port: WEATHER_SELECTION }, // optional — must never gate placement
    { port: BUILDING_PARAMS },
  ],
  affect: { buildings: [BUILDING_PARAMS] },
  layout: [],
});

const modelSave = defineModule({
  id: "model-save",
  params: [
    { port: MODEL_NAME, required: true },
    { port: COORDINATES, required: true },
    { port: BUILDINGS, required: true },
    { port: BUILDING_PARAMS, required: true },
    { port: SAVE_RESULT },
  ],
  affect: {},
  layout: ["sidebar"],
});

// One source of truth for ids: the fixtures declare them, everything downstream references them.
const registry: ModuleRegistry = Object.fromEntries(
  [modelStart, areaDraw, gridGeneration, buildingDemand, modelSave].map((module) => [
    module.id,
    module,
  ]),
);

/** What `model-start` seeds before any node runs. */
const SEEDS = [MODEL_NAME, "fromDate", "toDate", RESOLUTION, REGION] as const;

const node = (id: string, moduleId: string): Flow[number] => ({ id, moduleId });

// ── T10 ─────────────────────────────────────────────────────────────────────

describe("T10 — a module is placeable iff every required port exists", () => {
  it("offers only what the available-set already satisfies", () => {
    const available = availablePorts([], registry, SEEDS);

    const offered = palette(available, registry).map((module) => module.id);

    // area-draw's single requirement (region) is seeded; everything else needs produced data
    expect(offered).toEqual(["model-start", "area-draw"]);
  });

  it("names what is missing instead of offering a broken node", () => {
    const available = availablePorts([], registry, SEEDS);

    expect(missingPorts(gridGeneration, available)).toEqual([COORDINATES]);
    expect(missingPorts(modelSave, available)).toEqual([
      COORDINATES,
      BUILDINGS,
      BUILDING_PARAMS,
    ]);
    expect(missingPorts(areaDraw, available)).toEqual([]);
  });

  it("never gates on an optional param", () => {
    const available = availablePorts([node("grid", gridGeneration.id)], registry, SEEDS);

    // building-demand requires buildings (produced by the placed node) but only *offers*
    // weatherSelection — so it is placeable without any weather node upstream.
    expect(palette(available, registry).map((module) => module.id)).toContain(buildingDemand.id);
    expect(missingPorts(buildingDemand, available)).toEqual([]);
  });

  it("grows the available-set with each placed node", () => {
    const before = availablePorts([], registry, SEEDS);
    const after = availablePorts([node("grid", gridGeneration.id)], registry, SEEDS);

    expect(before.has(BUILDINGS)).toBe(false);
    expect(after.has(BUILDINGS)).toBe(true);
    expect(after.has(TRANSFORMERS)).toBe(true);
  });

  it("does not let a node satisfy its own requirement", () => {
    // grid-generation declares coordinates as both required and writable; it must not count as
    // its own producer, or every module would be placeable everywhere.
    const available = availablePorts([], registry, SEEDS);

    expect(missingPorts(gridGeneration, available)).toEqual([COORDINATES]);
  });
});

// ── T11 ─────────────────────────────────────────────────────────────────────

describe("T11 — the builder and the validator are the same predicate", () => {
  /** Grow a flow the only way the UI can: take whatever the palette offers, in order. */
  function buildGreedily(): Flow {
    // `Flow` is readonly by design — a builder assembles a mutable list and hands it over once.
    const flow: FlowNode[] = [];
    for (let step = 0; step < registryCount(); step += 1) {
      const available = availablePorts(flow, registry, SEEDS);
      const placed = new Set(flow.map((entry) => entry.moduleId));
      const next = palette(available, registry).find((module) => !placed.has(module.id));
      if (next === undefined) break;
      flow.push(node(next.id, next.id));
    }
    return flow;
  }

  function registryCount(): number {
    return Object.keys(registry).length;
  }

  it("builds a flow that validates with no second pass", () => {
    const flow = buildGreedily();

    expect(flow.map((entry) => entry.moduleId)).toEqual([
      modelStart.id,
      areaDraw.id,
      gridGeneration.id,
      buildingDemand.id,
      modelSave.id,
    ]);
    expect(placementReport(flow, registry, SEEDS).every((entry) => entry.placeable)).toBe(true);
    expect(isValidFlow(flow, registry, SEEDS)).toBe(true);
  });

  it("reports a hand-built violation as unplaceable, not merely invalid", () => {
    // demand before its producer: buildings was never produced at this position
    const broken: Flow = [node("start", modelStart.id), node("demand", buildingDemand.id)];

    const report = placementReport(broken, registry, SEEDS);

    expect(report[1]).toMatchObject({
      nodeId: "demand",
      placeable: false,
      missing: [BUILDINGS],
    });
    expect(isValidFlow(broken, registry, SEEDS)).toBe(false);
    // the palette could not have produced it — the same predicate that offers modules refuses it
    expect(palette(availablePorts([node("start", modelStart.id)], registry, SEEDS), registry).map((module) => module.id))
      .not.toContain(buildingDemand.id);
  });

  it("is unaffected by ports a node merely writes later", () => {
    const full: Flow = [
      node("start", modelStart.id),
      node("area", areaDraw.id),
      node("grid", gridGeneration.id),
      node("demand", buildingDemand.id),
      node("save", modelSave.id),
    ];

    const report = placementReport(full, registry, SEEDS);

    expect(report.map((entry) => entry.placeable)).toEqual([true, true, true, true, true]);
  });
});
