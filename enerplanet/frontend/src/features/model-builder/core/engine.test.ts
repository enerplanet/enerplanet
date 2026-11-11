/**
 * Core contract — store, sealed transaction, write boundary (cases T1–T3).
 *
 * Spec: `.local/ModularThesis/spec/core.md` §A. These lock `Plan.md` §2.1/§2.2
 * (single store, one reducer) and §12 (contract-checked writes).
 *
 * Written failing first, before any implementation exists.
 */
import { describe, it, expect } from "vitest";
import { createStore } from "./store";
import { createEngine } from "./engine";
import { defineModule } from "./module";
import { PortWriteRejected } from "./errors";
import type { ModelData } from "./ports";

// ── fixtures ────────────────────────────────────────────────────────────────

function fc(features: GeoJSON.Feature[] = []): GeoJSON.FeatureCollection {
  return { type: "FeatureCollection", features };
}

function building(osmId: string): GeoJSON.Feature {
  return {
    type: "Feature",
    properties: { osmId },
    geometry: { type: "Point", coordinates: [8.68, 49.41] },
  };
}

function seed(overrides: Partial<ModelData> = {}): ModelData {
  return {
    modelName: "Contract fixture",
    fromDate: "2025-01-01",
    toDate: "2025-12-31",
    resolution: 60,
    coordinates: [],
    buildings: fc(),
    ...overrides,
  };
}

/** Runs a promise expected to reject and returns the rejection for inspection. */
async function captureError(promise: Promise<unknown>): Promise<PortWriteRejected> {
  try {
    await promise;
  } catch (err) {
    return err as PortWriteRejected;
  }
  throw new Error("expected the call to reject, but it resolved");
}

// ── T1 ──────────────────────────────────────────────────────────────────────

describe("T1 — one sealed transaction per action", () => {
  const NODE_ID = "grid-generation";

  it("seals every write of one run() into a single transaction", async () => {
    const store = createStore(seed());
    const engine = createEngine(store);
    const module = defineModule({
      id: NODE_ID,
      params: [{ port: "coordinates", required: true }, { port: "buildings", required: true }, { port: "transformers" }],
      affect: {},
      layout: [],
      run: (ctx) => {
        ctx.read("buildings");
        ctx.commit({ transformers: fc() }); // add — port not present yet
        ctx.commit({ buildings: fc([building("1")]) }); // mutate — read above
      },
      validate: () => [],
    });

    await engine.runModule(module, NODE_ID);

    expect(store.log).toHaveLength(1);
    const [txn] = store.log;
    expect(txn.primary.map((op) => op.path).sort()).toEqual(["/buildings", "/transformers"]);
    expect(txn.cascade).toEqual([]);
    expect(txn.nodeId).toBe(NODE_ID);
    expect(store.data.buildings?.features).toHaveLength(1);
    expect(store.data.transformers).toEqual(fc());
  });

  it("never exposes a half-applied state while run() is in flight", async () => {
    const store = createStore(seed());
    const engine = createEngine(store);
    const observedInsideRun: Array<{ buildings: number; log: number }> = [];
    const module = defineModule({
      id: "two-writes",
      params: [{ port: "buildings" }, { port: "transformers" }],
      affect: {},
      layout: [],
      run: (ctx) => {
        ctx.read("buildings");
        ctx.commit({ buildings: fc([building("1")]) });
        observedInsideRun.push({
          buildings: ctx.store.buildings?.features.length ?? -1,
          log: store.log.length,
        });
        ctx.commit({ transformers: fc() });
      },
      validate: () => [],
    });

    await engine.runModule(module, "two-writes");

    expect(observedInsideRun).toEqual([{ buildings: 0, log: 0 }]);
    expect(store.data.buildings?.features).toHaveLength(1);
    expect(store.data.transformers).toEqual(fc());
    expect(store.log).toHaveLength(1);
  });
});

// ── T2 ──────────────────────────────────────────────────────────────────────

describe("T2 — undeclared port writes are rejected at the boundary", () => {
  const MODULE_ID = "declares-buildings-only";

  it("rejects a write to a port the module did not declare", async () => {
    const store = createStore(seed());
    const engine = createEngine(store);
    const module = defineModule({
      id: MODULE_ID,
      params: [{ port: "buildings" }],
      affect: {},
      layout: [],
      run: (ctx) => {
        ctx.commit({ technologies: { b1: [{ techId: "pv" }] } });
      },
      validate: () => [],
    });

    const error = await captureError(engine.runModule(module, MODULE_ID));

    expect(error).toBeInstanceOf(PortWriteRejected);
    expect(error.moduleId).toBe(MODULE_ID);
    expect(error.port).toBe("technologies");
    expect(error.reason).toBe("undeclared");
    expect(store.log).toHaveLength(0);
    expect(store.data.technologies).toBeUndefined();
  });
});

// ── T3 ──────────────────────────────────────────────────────────────────────

describe("T3 — anti-clobber: you may only rewrite what you read", () => {
  const BLIND_ID = "blind-overwriter";

  it("rejects a blind overwrite of a port the module never read", async () => {
    const store = createStore(seed());
    const engine = createEngine(store);
    const blind = defineModule({
      id: BLIND_ID,
      params: [{ port: "buildings" }],
      affect: {},
      layout: [],
      run: (ctx) => {
        ctx.commit({ buildings: fc([building("9")]) });
      },
      validate: () => [],
    });

    const error = await captureError(engine.runModule(blind, BLIND_ID));

    expect(error).toBeInstanceOf(PortWriteRejected);
    expect(error.port).toBe("buildings");
    expect(error.reason).toBe("clobber");
    expect(store.data.buildings?.features).toHaveLength(0);
    expect(store.log).toHaveLength(0);
  });

  it("allows rewriting a declared port that was read first", async () => {
    const store = createStore(seed());
    const engine = createEngine(store);
    const editor = defineModule({
      id: "building-editor",
      params: [{ port: "buildings" }],
      affect: {},
      layout: [],
      run: (ctx) => {
        const current = ctx.read("buildings");
        ctx.commit({ buildings: fc([...(current?.features ?? []), building("1")]) });
      },
      validate: () => [],
    });

    await engine.runModule(editor, "building-editor");

    expect(store.data.buildings?.features).toHaveLength(1);
    expect(store.log).toHaveLength(1);
  });

  it("allows adding a port that is absent without reading it first", async () => {
    const store = createStore(seed());
    const engine = createEngine(store);
    const producer = defineModule({
      id: "transformer-producer",
      params: [{ port: "transformers" }],
      affect: {},
      layout: [],
      run: (ctx) => {
        ctx.commit({ transformers: fc() });
      },
      validate: () => [],
    });

    await engine.runModule(producer, "transformer-producer");

    expect(store.data.transformers).toEqual(fc());
    expect(store.log).toHaveLength(1);
    expect(store.log[0].primary[0]).toMatchObject({ op: "replace", path: "/transformers", prev: undefined });
  });
});
