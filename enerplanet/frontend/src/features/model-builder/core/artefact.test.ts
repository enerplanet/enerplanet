/**
 * The artefact — persisting a session.
 *
 * v2 model (`spec/history-v2.md` §3.1): a session is `(projection, flow, log)`. The stored
 * projection is used directly on load (**no replay**) so a session opens instantly, and the
 * **placed flow** rides along as data (§3.1) — the seed placements plus appends, to-run nodes
 * included. The fingerprint guards the cache: when it disagrees with the stored projection, the
 * loader replays the log instead and says so. Replay stays the recovery path, never the load path.
 *
 * Because the log is append-only with no redo tail and the view is not persisted, `cursor` and
 * `discarded` are gone; a rollback (an undo) is just a commit in the log.
 *
 * Written failing first against the new design.
 */
import { describe, it, expect } from "vitest";
import { fromArtefact, replayArtefact, toArtefact, type Artefact } from "./artefact";
import { nodeStates, position } from "./position";
import { transcript, type Flow, type ModuleRegistry } from "./flow";
import { fingerprint } from "./fingerprint";
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

const FLOW: Flow = [start, draw, grid, save].map((module) => ({ id: module.id, moduleId: module.id }));
const WORKFLOW = { id: "wf-core", version: 3 };

async function runAll(store: ReturnType<typeof createStore>): Promise<void> {
  const engine = createEngine(store);
  for (const module of [start, draw, grid, save]) {
    await engine.runModule(module, { id: module.id, moduleId: module.id });
  }
}


describe("the artefact carries the state, the flow and the log", () => {
  it("round-trips a session, and undo/redo work again on the load", async () => {
    const store = createStore(seed());
    await runAll(store);
    store.undo(); // append a rollback, so the round-trip has history to carry

    const artefact = toArtefact({ store, workflow: WORKFLOW, flow: FLOW, modelId: 42 });
    const { store: loaded, divergence } = fromArtefact(artefact);

    expect(divergence).toBeUndefined();
    expect(artefact.log).toHaveLength(store.log.length); // the append-only log, whole
    expect(artefact.flow).toEqual(FLOW); // the placed flow rides along (§3.1)
    expect(artefact).toMatchObject({ version: 1, modelId: 42 });
    expect(artefact.workflow).toEqual(WORKFLOW);
    expect("cursor" in artefact).toBe(false);
    expect("discarded" in artefact).toBe(false);

    expect(loaded.data).toEqual(store.data);
    expect(loaded.initial).toEqual(store.initial);
    expect(loaded.canUndo).toBe(store.canUndo);

    // The carried rollback is redoable: redo re-applies what the undo resolved away…
    const redone = loaded.redo();
    expect(redone).toBeDefined();
    expect(loaded.data.saveResult).toEqual({ modelId: 1, created: true });
    // …and undo takes it back to the carried state.
    expect(loaded.undo()).toBeDefined();
    expect(loaded.data).toEqual(store.data);
  });

  it("trusts the stored projection on load — no replay", async () => {
    const store = createStore(seed());
    await runAll(store);
    const artefact = toArtefact({ store, workflow: WORKFLOW, flow: FLOW });

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
    const artefact = toArtefact({ store, workflow: WORKFLOW, flow: FLOW });
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

    const artefact = toArtefact({ store, workflow: WORKFLOW, flow: FLOW });
    const { store: loaded, flow } = fromArtefact(artefact);

    expect(Object.keys(artefact.workflow).sort()).toEqual(["id", "version"]);
    expect(position(flow, registry, loaded)).toEqual(position(FLOW, registry, store));
    expect(nodeStates(flow, registry, loaded)).toEqual(nodeStates(FLOW, registry, store));
  });

  it("needs no separate list for undos — a rollback is a commit like any other", async () => {
    const store = createStore(seed());
    await runAll(store);
    store.undo(); // appends rollback{of:4}

    const artefact = toArtefact({ store, workflow: WORKFLOW, flow: FLOW });
    const rollbacks = artefact.log.filter((commit) => commit.rollback !== undefined);

    expect(rollbacks).toHaveLength(1);
    expect(rollbacks[0].rollback).toEqual({ of: 4 });

    const { store: loaded } = fromArtefact(artefact);
    expect(loaded.canRedo).toBe(true);
    expect(transcript(FLOW, loaded.log).map((node) => node.id)).toEqual([
      "start",
      "draw",
      "grid",
      "save",
    ]);
  });

  it("refuses an artefact whose shape it does not know", async () => {
    const store = createStore(seed());
    await runAll(store);
    const artefact = toArtefact({ store, workflow: WORKFLOW, flow: FLOW });

    expect(() => fromArtefact({ ...artefact, version: 99 } as Artefact)).toThrow(/version/);
  });
});
