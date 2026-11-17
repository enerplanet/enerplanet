/**
 * Core contract — store, sealed transaction, write boundary.
 *
 * These lock the single store with one reducer, and contract-checked writes.
 *
 * Written failing first, before any implementation exists.
 */
import { describe, it, expect } from "vitest";
import { createStore } from "./store";
import { createEngine } from "./engine";
import { defineModule } from "./module";
import { MissingRequiredPorts, PortWriteRejected } from "./errors";
import { building, captureError, fc, seed } from "./fixtures";


describe("one sealed transaction per action", () => {
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


describe("undeclared port writes are rejected at the boundary", () => {
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


describe("anti-clobber: you may only rewrite what you read", () => {
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


describe("seal granularity is a module declaration", () => {
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


describe("a write that carries nothing is refused", () => {
  const NODE_ID = "writes-nothing";

  /** One write, of whatever the case is about. */
  function writing(changes: Record<string, unknown>) {
    return defineModule({
      id: NODE_ID,
      params: [{ port: "modelName" }, { port: "transformers" }, { port: "grids" }],
      affect: {},
      layout: [],
      run: (ctx) => ctx.commit(changes as never),
      validate: () => [],
    });
  }

  it("rejects an empty string, so a form cannot commit a name nobody typed", async () => {
    const store = createStore(seed());
    const engine = createEngine(store);

    const error = await captureError<PortWriteRejected>(
      engine.runModule(writing({ modelName: "   " }), { id: NODE_ID }),
    );

    expect(error).toBeInstanceOf(PortWriteRejected);
    expect(error.port).toBe("modelName");
    expect(error.reason).toBe("empty");
    expect(store.log).toHaveLength(0);
    expect(store.data.modelName).toBe("Contract fixture"); // untouched
  });

  it("rejects null, which is an absent value wearing a value's clothes", async () => {
    const store = createStore(seed());
    const engine = createEngine(store);

    const error = await captureError<PortWriteRejected>(
      engine.runModule(writing({ transformers: null }), { id: NODE_ID }),
    );

    expect(error?.reason).toBe("empty");
    expect(store.log).toHaveLength(0);
  });

  it("rejects undefined: clearing is the invalidator's job, never a module's", async () => {
    // Only the cascade removes a port, and it does so through a `remove` op carrying the previous
    // value. A module that wants a port gone is really saying its work is not finished — which is what
    // `validate()` is for.
    const store = createStore(seed());
    const engine = createEngine(store);

    const error = await captureError<PortWriteRejected>(
      engine.runModule(writing({ transformers: undefined }), { id: NODE_ID }),
    );

    expect(error?.reason).toBe("empty");
    expect(store.log).toHaveLength(0);
  });

  it("accepts a zero-member collection: an empty set is a fact, not an absence", async () => {
    // The line this rule draws. "No transformers in this area" is an answer the module is entitled to
    // give; whether that answer is *finished* is the module's own call in `validate()`, not the engine's.
    const store = createStore(seed());
    const engine = createEngine(store);

    await engine.runModule(writing({ transformers: fc(), grids: [] }), { id: NODE_ID });

    expect(store.data.transformers).toEqual(fc());
    expect(store.data.grids).toEqual([]);
    expect(store.log).toHaveLength(1);
  });

  it("accepts zero and false, which are values", async () => {
    // Worth pinning: `false` and `0` are answers, and a naive emptiness check would swallow them.
    const store = createStore(seed());
    const engine = createEngine(store);

    await engine.runModule(writing({ grids: [{ count: 0, served: false }] }), { id: NODE_ID });

    expect(store.data.grids).toEqual([{ count: 0, served: false }]);
  });
});

describe("a node runs only when its required ports exist in the store", () => {
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
