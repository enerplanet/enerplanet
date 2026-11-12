/**
 * The artefact — persisting a session (case T18).
 *
 * Spec: `.local/ModularThesis/spec/core.md` §F. On load the stored projection is used directly
 * (**no replay**) so a session opens instantly, undo/redo work at once from `cursor`, and the flow
 * is reattached by *reference* — it is immutable, so it is never copied. The fingerprint guards the
 * cache: when it disagrees with the stored projection, the loader replays the log instead and says
 * so. Replay stays the recovery path, never the load path.
 *
 * Written failing first.
 */
import { describe, it, expect } from "vitest";
import { fromArtefact, replayArtefact, toArtefact, type Artefact } from "./artefact";
import { jumpTo } from "./rerun";
import { nodeStates, position } from "./position";
import { fingerprint } from "./fingerprint";
import type { ModuleRegistry } from "./flow";
import { createEngine } from "./engine";
import { createStore } from "./store";
import { defineModule } from "./module";
import { building, fc, seed } from "./fixtures";
import type { PortKey } from "./ports";

// ── a four-node flow ────────────────────────────────────────────────────────

const REGION: PortKey = "region";
const COORDINATES: PortKey = "coordinates";
const BUILDINGS: PortKey = "buildings";
const SAVE_RESULT: PortKey = "saveResult";

const start = defineModule({
  id: "start",
  params: [{ port: REGION }],
  affect: {},
  layout: [],
  run: (ctx) => ctx.commit({ region: { country: "DE", state: "BW" } }),
  validate: () => [],
});

const draw = defineModule({
  id: "draw",
  params: [{ port: REGION, required: true }, { port: COORDINATES }],
  affect: { region: [COORDINATES] },
  layout: [],
  run: (ctx) => {
    ctx.read(COORDINATES);
    ctx.commit({ coordinates: [[[8.6, 49.4]]] });
  },
  validate: () => [],
});

const grid = defineModule({
  id: "grid",
  params: [{ port: COORDINATES, required: true }, { port: BUILDINGS }],
  affect: { coordinates: [BUILDINGS] },
  layout: [],
  run: (ctx) => {
    ctx.read(BUILDINGS);
    ctx.commit({ buildings: fc([building("b1")]) });
  },
  validate: () => [],
});

const save = defineModule({
  id: "save",
  params: [{ port: BUILDINGS, required: true }, { port: SAVE_RESULT }],
  affect: {},
  layout: [],
  run: (ctx) => ctx.commit({ saveResult: { modelId: 1, created: true } }),
  validate: () => [],
});

const registry: ModuleRegistry = Object.fromEntries(
  [start, draw, grid, save].map((module) => [module.id, module]),
);

const FLOW = [start, draw, grid, save].map((module) => ({ id: module.id, moduleId: module.id }));
const WORKFLOW = { id: "wf-core", version: 3 };

async function runAll(store: ReturnType<typeof createStore>): Promise<void> {
  const engine = createEngine(store);
  for (const module of [start, draw, grid, save]) {
    await engine.runModule(module, { id: module.id });
  }
}

// ── T18 ─────────────────────────────────────────────────────────────────────

describe("T18 — the artefact carries the state, and the log can rebuild it", () => {
  it("round-trips a session, and undo/redo work immediately from the cursor", async () => {
    const store = createStore(seed());
    await runAll(store);
    store.undo(); // leaves a discard stack, so the round-trip has a tail to carry

    const artefact = toArtefact({ store, workflow: WORKFLOW, modelId: 42 });
    const { store: loaded, divergence } = fromArtefact(artefact);

    expect(divergence).toBeUndefined();
    expect(artefact.log).toHaveLength(store.cursor); // the applied prefix…
    expect(artefact.discarded).toHaveLength(1); // …and the redo tail beside it
    expect(artefact).toMatchObject({ version: 1, modelId: 42, cursor: store.cursor });
    expect(artefact.workflow).toEqual(WORKFLOW);

    expect(loaded.data).toEqual(store.data);
    expect(loaded.initial).toEqual(store.initial);
    expect(loaded.cursor).toBe(store.cursor);
    expect(loaded.canRedo).toBe(true);

    loaded.undo();
    expect(loaded.cursor).toBe(store.cursor - 1);
    loaded.redo();
    expect(loaded.cursor).toBe(store.cursor);
    expect(loaded.data).toEqual(store.data);
  });

  it("trusts the stored projection on load — no replay", async () => {
    const store = createStore(seed());
    await runAll(store);
    const artefact = toArtefact({ store, workflow: WORKFLOW });

    // Corrupt the log, leaving the projection and its fingerprint alone: replaying would now
    // disagree with what was stored, and the loader must not notice — that is the trade the
    // fingerprint buys, and the next case covers the other side of it.
    artefact.log[0] = {
      ...artefact.log[0],
      primary: [{ op: "replace", path: "/modelName", prev: "x", next: "tampered" }],
    };

    const { store: loaded, divergence } = fromArtefact(artefact);

    expect(divergence).toBeUndefined();
    expect(loaded.data.modelName).toBe("Contract fixture");
    expect(replayArtefact(artefact).modelName).toBe("tampered"); // the log really did disagree
  });

  it("replays the log when the fingerprint disagrees, and reports the divergence", async () => {
    const store = createStore(seed());
    await runAll(store);
    const artefact = toArtefact({ store, workflow: WORKFLOW });
    const honest = replayArtefact(artefact);

    artefact.projection = { ...artefact.projection, modelName: "tampered" };

    const { store: loaded, divergence } = fromArtefact(artefact);

    expect(divergence).toBeDefined();
    expect(divergence?.stored).toBe(artefact.fingerprint);
    expect(divergence?.projection).not.toBe(divergence?.stored);
    expect(divergence?.recovered).toBe(fingerprint(honest));
    // The log is the source of truth: the tampered value is gone, not adopted.
    expect(loaded.data.modelName).toBe("Contract fixture");
    expect(loaded.data).toEqual(honest);
  });

  it("carries the workflow as a reference, so states and position re-derive on load", async () => {
    const store = createStore(seed());
    await runAll(store);

    const artefact = toArtefact({ store, workflow: WORKFLOW });
    const { store: loaded } = fromArtefact(artefact);

    // No flow copy: just the reference. Reattaching it is the caller's lookup.
    expect(Object.keys(artefact.workflow).sort()).toEqual(["id", "version"]);
    expect(position(FLOW, registry, loaded)).toEqual(position(FLOW, registry, store));
    expect(nodeStates(FLOW, registry, loaded)).toEqual(nodeStates(FLOW, registry, store));
  });

  it("needs no separate list for jumps — they are transactions like any other", async () => {
    const store = createStore(seed());
    await runAll(store);
    jumpTo(FLOW, registry, store, "draw");

    const artefact = toArtefact({ store, workflow: WORKFLOW });
    const jumps = artefact.log.filter((transaction) => transaction.kind === "jump");

    expect(jumps).toHaveLength(1);
    expect(jumps[0].jump).toEqual({ from: "save", to: "draw" });

    const { store: loaded } = fromArtefact(artefact);
    expect(position(FLOW, registry, loaded)).toMatchObject({ index: 1, nodeId: "draw" });
  });

  it("refuses an artefact whose shape it does not know", async () => {
    const store = createStore(seed());
    await runAll(store);
    const artefact = toArtefact({ store, workflow: WORKFLOW });

    expect(() => fromArtefact({ ...artefact, version: 99 } as Artefact)).toThrow(/version/);
  });

  it("refuses a cursor outside the log it came with", async () => {
    const store = createStore(seed());
    await runAll(store);
    const artefact = toArtefact({ store, workflow: WORKFLOW });

    expect(() => fromArtefact({ ...artefact, cursor: 99 })).toThrow(/cursor/);
  });
});
