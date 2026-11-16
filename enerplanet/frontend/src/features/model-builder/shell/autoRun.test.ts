/**
 * The auto-run decision and its guard (`spec/core.md` T15) — written failing first.
 *
 * The rule this file pins is the whole point of the change: an auto node runs **on arrival** and **once**,
 * and it must not run again for a re-render or for a jump's bare re-arm — only for a genuine input change
 * (the invalidator's staleness, T7), or the first time it is ever seen. `autoRunFor` is the decision and
 * `createAutoGuard` is the idempotency, so both are exercised here without a frame.
 */

import { describe, expect, it } from "vitest";
import { defineModule, type PortKey } from "@model-builder/core";
import { createEngine } from "../core/engine";
import { createStore, type Store } from "../core/store";
import { createInvalidator } from "../core/invalidate";
import { position } from "../core/position";
import { portPath, type DiffOp } from "../core/diff";
import type { Flow, ModuleRegistry } from "../core/flow";
import { autoRunFor, createAutoGuard } from "./autoRun";

const COORDINATES: PortKey = "coordinates";
const BUILDINGS: PortKey = "buildings";
const TECHNOLOGIES: PortKey = "technologies";

/** A drawn ring, in the store's coordinate type; two, so an upstream value can change. */
const AREA_0: [number, number][][] = [[[9.7, 50.5], [9.71, 50.5], [9.71, 50.51]]];
const AREA_1: [number, number][][] = [[[9.8, 50.6], [9.81, 50.6], [9.81, 50.61]]];

const BUILDINGS_VALUE = { type: "FeatureCollection", features: [] } as GeoJSON.FeatureCollection;

/** The three modules: a producer, the **auto** node, and the node after it. */
const producer = defineModule({
  id: "producer",
  params: [{ port: COORDINATES }],
  affect: { coordinates: [BUILDINGS] },
  layout: [],
  run: (ctx) => {
    ctx.read(COORDINATES);
    ctx.commit({ coordinates: AREA_1 });
  },
  validate: () => [],
});

const autoModule = defineModule({
  id: "auto-node",
  params: [{ port: COORDINATES, required: true }, { port: BUILDINGS }],
  affect: { coordinates: [BUILDINGS] },
  layout: [],
  run: (ctx) => {
    ctx.read(BUILDINGS);
    ctx.commit({ buildings: BUILDINGS_VALUE });
  },
  validate: () => [],
});

const afterwards = defineModule({
  id: "afterwards",
  params: [{ port: BUILDINGS, required: true }, { port: TECHNOLOGIES }],
  affect: {},
  layout: [],
  run: (ctx) => ctx.commit({ technologies: {} }),
  validate: () => [],
});

const REGISTRY: ModuleRegistry = {
  producer,
  "auto-node": autoModule,
  afterwards,
};

const FLOW: Flow = [
  { id: "a", moduleId: "producer" },
  { id: "auto", moduleId: "auto-node", auto: true },
  { id: "n", moduleId: "afterwards" },
];

function session(): Store {
  return createStore(
    { coordinates: AREA_0 },
    { deriveCascade: createInvalidator(FLOW, REGISTRY) },
  );
}

/** Run one node the way the frame does — the auto node stamped `auto`. */
async function runNode(store: Store, id: string, moduleId: string, auto = false): Promise<void> {
  await createEngine(store).runModule(REGISTRY[moduleId], auto ? { id, auto: true } : { id });
}

function replace(port: PortKey, prev: unknown, next: unknown): DiffOp {
  return { op: "replace", path: portPath(port), prev, next };
}

describe("the auto-run decision (autoRunFor)", () => {
  it("plans a run the moment the session lands on an auto node that never ran", async () => {
    const store = session();
    await runNode(store, "a", "producer");

    // The position has moved onto the auto node and it is `pending` — never run.
    expect(position(FLOW, REGISTRY, store)).toMatchObject({ index: 1, nodeId: "auto" });

    const plan = autoRunFor(FLOW, REGISTRY, store);
    expect(plan).toMatchObject({ id: "auto" });
    expect(plan?.module.id).toBe("auto-node");
  });

  it("plans nothing for an interactive node, or a complete flow", async () => {
    const store = session();
    // Before anything runs the position is the interactive producer — not an auto node.
    expect(autoRunFor(FLOW, REGISTRY, store)).toBeUndefined();

    await runNode(store, "a", "producer");
    await runNode(store, "auto", "auto-node", true);
    // The auto node's run made it done, so the position advanced onto the interactive tail — nothing to run.
    expect(position(FLOW, REGISTRY, store)).toMatchObject({ index: 2, nodeId: "n" });
    expect(autoRunFor(FLOW, REGISTRY, store)).toBeUndefined();
  });

  it("waits, rather than erroring, when a required input is missing (T21)", () => {
    // The only node is the auto one, and its required input is absent: it *cannot* run.
    const flow: Flow = [{ id: "auto", moduleId: "auto-node", auto: true }];
    const store = createStore({}, { deriveCascade: createInvalidator(flow, REGISTRY) });

    expect(position(flow, REGISTRY, store)).toMatchObject({ index: 0, nodeId: "auto" });
    expect(autoRunFor(flow, REGISTRY, store)).toBeUndefined();
  });

  it("does NOT plan a re-run when the session comes back with nothing changed (rule 3)", async () => {
    const store = session();
    await runNode(store, "a", "producer");
    await runNode(store, "auto", "auto-node", true);

    // Coming back: a bare jump to the auto node, discarding nothing. Its work is still in the store.
    store.applyTransaction([], [], {
      node: { id: "auto", auto: true },
      kind: "jump",
      jump: { from: "n", to: "auto" },
    });

    // The re-arm does **not** apply to an auto node: it stays done, the position passes over it, and there is
    // nothing to re-run. This is the trap the two rules exist to avoid — a re-arm is not an input change.
    expect(autoRunFor(FLOW, REGISTRY, store)).toBeUndefined();
    expect(store.data.buildings).toBeDefined();
  });

  it("DOES plan a re-run when an upstream change pruned the node's work (rule 4)", async () => {
    const store = session();
    await runNode(store, "a", "producer");
    await runNode(store, "auto", "auto-node", true);

    // An input change: the invalidator prunes what that input affects (T7). `coordinates` affects `buildings`,
    // so the auto node's output is gone and it is genuinely stale — not merely re-armed.
    store.applyTransaction([replace(COORDINATES, AREA_0, AREA_1)], undefined, { node: { id: "a" } });

    expect(position(FLOW, REGISTRY, store)).toMatchObject({ index: 1, nodeId: "auto" });
    expect(autoRunFor(FLOW, REGISTRY, store)).toMatchObject({ id: "auto" });
  });
});

describe("the auto-run guard (createAutoGuard)", () => {
  it("claims a run once — a re-render or StrictMode's double-invoke is not a second run", async () => {
    const store = session();
    await runNode(store, "a", "producer");
    const guard = createAutoGuard();
    const plan = autoRunFor(FLOW, REGISTRY, store)!;

    expect(guard.claim(plan)).toBe(true); // the run is claimed
    expect(guard.claim(plan)).toBe(false); // the same attempt again — skipped
    expect(guard.claim(plan)).toBe(false); // …and again
  });

  it("claims a fresh run once the store has moved on (an input change is a new attempt)", async () => {
    const store = session();
    await runNode(store, "a", "producer");
    const guard = createAutoGuard();

    expect(guard.claim(autoRunFor(FLOW, REGISTRY, store)!)).toBe(true);

    // The change prunes the auto node's output and moves the store's change token, so the next plan is a new
    // attempt — the same node, a different fingerprint.
    store.applyTransaction([replace(COORDINATES, AREA_0, AREA_1)], undefined, { node: { id: "a" } });
    const next = autoRunFor(FLOW, REGISTRY, store)!;

    expect(guard.claim(next)).toBe(true);
  });
});
