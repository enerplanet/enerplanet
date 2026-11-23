/**
 * The invalidator: *the cascade is the affected closure, minus what it cannot touch*.
 *
 * Written failing first.
 *
 * The cascade is staged from a **primary** diff (what an action changed) and answers one question:
 * which *other* ports does this working model no longer have a right to keep? The answer is three
 * rules, and each of them is a case below:
 *
 * 1. the port is in the **`affect` closure** of the changed ports (transitively — an edge is
 *    `input → outputs that input affects`, and a chain of them is the closure);
 * 2. the port is **present** in the projection (nothing to prune otherwise);
 * 3. the port is **not already written by the primary** (the change supersedes it).
 *
 * Two things it deliberately does *not* do, and the second case pins each:
 *
 * - it never prunes outside the declared closure, however stale something might look;
 * - it does not try to predict what a re-run would produce. An earlier draft wanted to drop a
 *   prune when "re-running would give the same value" — impossible without running it. That finer
 *   minimality belongs at the **re-run** boundary (the no-op-write drop), not here.
 *
 * The prober in `influence.ts` is what keeps rule 1 honest: an *under*-declared edge would let
 * this function leave a port alone that should have gone, which is silent stale data.
 */
import { describe, it, expect } from "vitest";
import { createInvalidator } from "./invalidate";
import { defineModule } from "./module";
import type { ModuleRegistry } from "./flow";
import { createStore } from "./store";
import { createEngine } from "./engine";
import { portPath } from "./diff";
import { fc, seed } from "./fixtures";
import type { PortKey } from "./ports";

// ── modules with declared influence only; their runs are irrelevant here ──────
//
// `region → coordinates → buildings` is a two-step chain, which is what makes the closure's
// transitivity observable. `transformers` is written with no edge pointing at it, so it is the
// "outside the closure" control.

const start = defineModule({
  id: "start",
  params: [{ port: "region" }],
  affect: {},
  layout: [],
  run: (ctx) => ctx.commit({ region: { country: "DE", state: "BW" } }),
  validate: () => [],
});

const draw = defineModule({
  id: "draw",
  params: [{ port: "region", required: true }, { port: "coordinates" }],
  affect: { region: ["coordinates"] },
  layout: [],
  run: (ctx) => {
    ctx.read("coordinates");
    ctx.commit({ coordinates: [[[8.6, 49.4]]] });
  },
  validate: () => [],
});

const grid = defineModule({
  id: "grid",
  params: [{ port: "coordinates", required: true }, { port: "buildings" }, { port: "transformers" }],
  affect: { coordinates: ["buildings"] },
  layout: [],
  run: (ctx) => {
    ctx.read("buildings");
    ctx.commit({ buildings: fc(), transformers: fc() });
  },
  validate: () => [],
});

const registry: ModuleRegistry = Object.fromEntries(
  [start, draw, grid].map((module) => [module.id, module]),
);
const FLOW = [start, draw, grid].map((module) => ({ id: module.id, moduleId: module.id }));

/** The other-region value every case changes `region` to — one name, so the cases read the same. */
const ELSEWHERE = { country: "DE", state: "BY" };

/** A store with the whole chain applied — the projection a cascade is computed against. */
async function applied(): Promise<ReturnType<typeof createStore>> {
  const store = createStore(seed({ coordinates: [] }));
  const engine = createEngine(store);
  for (const module of [start, draw, grid]) {
    await engine.runModule(module, { id: module.id, moduleId: module.id });
  }
  return store;
}

/** The ops a primary change to one port produces, as the engine would hand them over. */
function primaryRoad(port: PortKey, next: unknown): { op: "replace"; path: string; prev: unknown; next: unknown } {
  return { op: "replace", path: portPath(port), prev: undefined, next };
}

describe("the cascade is the affected closure, minus what it cannot touch", () => {
  it("prunes what the changed port affects, and follows the closure transitively", async () => {
    const store = await applied();
    const invalidate = createInvalidator(FLOW, registry);

    // Changing `region` affects `coordinates`, which affects `buildings` — both are present, so
    // both go. This is the transitive half: `region` has no direct edge to `buildings`.
    const cascade = invalidate([primaryRoad("region", ELSEWHERE)], store.data);

    expect(cascade.map((op) => op.path).sort()).toEqual([portPath("buildings"), portPath("coordinates")]);
  });

  it("never prunes outside the declared closure", async () => {
    const store = await applied();
    const invalidate = createInvalidator(FLOW, registry);

    // `transformers` is written in the same node as `buildings` but nothing declares an edge to
    // it, so it stays — however tempting a "that node is stale" shortcut would be.
    const cascade = invalidate([primaryRoad("region", ELSEWHERE)], store.data);

    expect(cascade.map((op) => op.path)).not.toContain(portPath("transformers"));
    expect(store.data.transformers).toBeDefined();
  });

  it("does not prune a port that is absent — there is nothing to discard", async () => {
    const store = await applied();
    const invalidate = createInvalidator(FLOW, registry);
    const pruned = store.applyTransaction([], [{ op: "remove", path: portPath("buildings"), prev: undefined }]);

    expect(pruned.cascade).toHaveLength(1);
    expect(store.data.buildings).toBeUndefined();

    // `buildings` is in the closure of `region`, but it is already gone: a second prune would be a
    // no-op op in the log, and the cascade is what *actually* changed.
    const cascade = invalidate([primaryRoad("region", ELSEWHERE)], store.data);

    expect(cascade.map((op) => op.path)).toEqual([portPath("coordinates")]);
  });

  it("does not prune a port the primary already writes", async () => {
    const store = await applied();
    const invalidate = createInvalidator(FLOW, registry);

    // The action rewrites `coordinates` and `region` together. `coordinates` is in `region`'s
    // closure, but the primary supersedes it — pruning it would throw away the value the action
    // is in the middle of writing.
    const cascade = invalidate(
      [
        primaryRoad("region", ELSEWHERE),
        primaryRoad("coordinates", [[[8.7, 49.5]]]),
      ],
      store.data,
    );

    expect(cascade.map((op) => op.path)).toEqual([portPath("buildings")]);
  });

  it("carries each pruned port's previous value, so undo can restore it exactly", async () => {
    const store = await applied();
    const invalidate = createInvalidator(FLOW, registry);
    const before = store.data.buildings;

    const cascade = invalidate([primaryRoad("region", ELSEWHERE)], store.data);
    const buildings = cascade.find((op) => op.path === portPath("buildings"));

    expect(buildings).toMatchObject({ op: "remove", prev: before });
  });
});
