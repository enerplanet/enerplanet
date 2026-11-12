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
import { MissingRequiredPorts, PortWriteRejected } from "./errors";
import { building, captureError, fc, seed } from "./fixtures";

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

    await engine.runModule(module, { id: NODE_ID });

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

    await engine.runModule(module, { id: "two-writes" });

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

    const error = await captureError(engine.runModule(module, { id: MODULE_ID }));

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

    const error = await captureError(engine.runModule(blind, { id: BLIND_ID }));

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

    await engine.runModule(editor, { id: "building-editor" });

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

    await engine.runModule(producer, { id: "transformer-producer" });

    expect(store.data.transformers).toEqual(fc());
    expect(store.log).toHaveLength(1);
    expect(store.log[0].primary[0]).toMatchObject({ op: "replace", path: "/transformers", prev: undefined });
  });
});

// ── T16 ─────────────────────────────────────────────────────────────────────

describe("T16 — seal granularity is a module declaration", () => {
  /** Edits two independent fields — the shape `simulation-settings` really has. */
  function fieldEditor(id: string, seal?: "at-completion" | "per-commit") {
    return defineModule({
      id,
      seal,
      params: [{ port: "modelName" }, { port: "resolution" }],
      affect: {},
      layout: [],
      run: (ctx) => {
        ctx.read("modelName");
        ctx.read("resolution");
        ctx.commit({ modelName: "renamed" });
        ctx.commit({ resolution: 15 });
      },
      validate: () => [],
    });
  }

  it("per-commit seals one atomic transaction per commit", async () => {
    const store = createStore(seed());
    const engine = createEngine(store);
    const NODE_ID = "per-commit-editor";

    await engine.runModule(fieldEditor(NODE_ID, "per-commit"), { id: NODE_ID });

    expect(store.log).toHaveLength(2);
    expect(store.log.map((txn) => txn.primary.length)).toEqual([1, 1]);
    expect(store.log.every((txn) => txn.nodeId === NODE_ID)).toBe(true);

    // undo granularity follows: one config change, not the whole node
    store.undo();
    expect(store.data.resolution).toBe(60);
    expect(store.data.modelName).toBe("renamed");
  });

  it("at-completion seals the whole run as one transaction", async () => {
    const store = createStore(seed());
    const engine = createEngine(store);
    const NODE_ID = "whole-node-editor";

    await engine.runModule(fieldEditor(NODE_ID), { id: NODE_ID });

    expect(store.log).toHaveLength(1);
    expect(store.log[0].primary).toHaveLength(2);

    // one undo takes the whole node back
    store.undo();
    expect(store.data.resolution).toBe(60);
    expect(store.data.modelName).toBe("Contract fixture");
  });
});

// ── T21 ─────────────────────────────────────────────────────────────────────

describe("T21 — a node runs only when its required ports exist in the store", () => {
  const NODE_ID = "needs-region";

  /** Gated on `region`, which the plain seed does not have. */
  function gatedModule() {
    return defineModule({
      id: NODE_ID,
      params: [{ port: "region", required: true }, { port: "transformers" }],
      affect: {},
      layout: [],
      run: (ctx) => {
        ctx.commit({ transformers: fc() });
      },
      validate: () => [],
    });
  }

  it("refuses the run when a required port is missing, writing nothing", async () => {
    const store = createStore(seed());
    const engine = createEngine(store);

    const error = await captureError<MissingRequiredPorts>(
      engine.runModule(gatedModule(), { id: NODE_ID }),
    );

    expect(error).toBeInstanceOf(MissingRequiredPorts);
    expect(error.moduleId).toBe(NODE_ID);
    expect(error.missing).toEqual(["region"]);
    expect(store.log).toHaveLength(0);
    expect(store.data.transformers).toBeUndefined();
  });

  it("runs once the store satisfies the requirement", async () => {
    const store = createStore(seed({ region: { country: "DE", state: "BW" } }));
    const engine = createEngine(store);

    await engine.runModule(gatedModule(), { id: NODE_ID });

    expect(store.data.transformers).toEqual(fc());
    expect(store.log).toHaveLength(1);
  });
});
