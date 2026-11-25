/**
 * Re-run and repair: first-run-fills / re-run-appends, and goal-driven repair that re-runs only the
 * influence-affected placements, in transcript order, to a fixpoint.
 */
import { describe, it, expect } from "vitest";
import { repair, runPlacement, runTarget } from "./rerun";
import { transcript, type Flow, type ModuleRegistry } from "./flow";
import { createEngine } from "./engine";
import { createStore } from "./store";
import { defineModule } from "./module";
import { building, fc, seed } from "./fixtures";
import type { PortKey } from "./ports";

// ── a five-node flow: start → draw → settings → grid → save ──────────────────
// `settings` writes a port nothing downstream reads — the untouched-middle control.

const REGION: PortKey = "region";
const COORDINATES: PortKey = "coordinates";
const BUILDINGS: PortKey = "buildings";
const ADVANCED: PortKey = "advancedParams";
const SAVE_RESULT: PortKey = "saveResult";

const start = defineModule({
  id: "start",
  params: [{ port: REGION }],
  affect: { region: [] },
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

/** Writes a port nothing downstream reads — a middle placement that must never be re-run. */
const settings = defineModule({
  id: "settings",
  params: [{ port: "resolution" }, { port: ADVANCED }],
  affect: {},
  layout: [],
  run: (ctx) => {
    const resolution = ctx.read("resolution") ?? 60;
    ctx.commit({ advancedParams: { resolution } });
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
  [start, draw, settings, grid, save].map((module) => [module.id, module]),
);

/** Seed placements, ids `"<n>-<name>"`, contiguous from 0. */
const PLACED: Flow = [
  { id: "0-start", moduleId: "start" },
  { id: "1-draw", moduleId: "draw" },
  { id: "2-settings", moduleId: "settings" },
  { id: "3-grid", moduleId: "grid" },
  { id: "4-save", moduleId: "save" },
];

async function fillAll(store: ReturnType<typeof createStore>): Promise<void> {
  const run = createEngine(store).runModule;
  // Fill the placements the terminal actually depends on — `settings` is left un-run, so the
  // repair tests can prove it is never touched.
  for (const placement of [PLACED[0], PLACED[1], PLACED[3], PLACED[4]]) {
    await runPlacement(PLACED, registry, store, run, placement);
  }
}


describe("a run fills on first use and appends on re-use", () => {
  it("fills a pending seed placement, then appends a successor placement", async () => {
    const store = createStore(seed());
    const run = createEngine(store).runModule;

    await runPlacement(PLACED, registry, store, run, PLACED[0]);
    await runPlacement(PLACED, registry, store, run, PLACED[1]);

    // First run of `grid` FILLS its seed placement, `3-grid`.
    const first = await runPlacement(PLACED, registry, store, run, PLACED[3]);
    expect(first).toBe("3-grid");
    expect(store.log[2].node).toEqual({ id: "3-grid", moduleId: "grid" });

    // A re-run APPENDS a successor — `n` counts every placement so far (0..4 seeded), so it is 5.
    const second = await runPlacement(transcript(PLACED, store.log), registry, store, run, PLACED[3]);
    expect(second).toBe("5-grid");
    expect(store.log[3].node?.id).toBe("5-grid");

    // Both occurrences remain in the transcript.
    expect(transcript(PLACED, store.log).map((node) => node.id)).toEqual([
      "0-start",
      "1-draw",
      "2-settings",
      "3-grid",
      "4-save",
      "5-grid",
    ]);
  });

  it("mints a fresh successor id on repeat runs — never a reused n", async () => {
    const store = createStore(seed());
    const run = createEngine(store).runModule;
    await runPlacement(PLACED, registry, store, run, PLACED[0]);
    await runPlacement(PLACED, registry, store, run, PLACED[1]);

    const ids: Array<string | undefined> = [];
    let placed = PLACED;
    for (let i = 0; i < 3; i += 1) {
      const id = await runPlacement(placed, registry, store, run, PLACED[3]);
      ids.push(id);
      placed = transcript(PLACED, store.log);
    }

    expect(ids).toEqual(["3-grid", "5-grid", "6-grid"]);
    expect(new Set(ids).size).toBe(3); // monotonic, never reused
  });

  it("targets an un-run placement to fill, and a committed one to append", () => {
    const store = createStore(seed());
    const pending = runTarget(PLACED, store, PLACED[3]);
    expect(pending).toEqual({ id: "3-grid", moduleId: "grid" });

    store.applyTransaction([{ op: "replace", path: "/buildings", prev: undefined, next: fc() }], [], {
      node: { id: "3-grid", moduleId: "grid" },
    });
    const reRun = runTarget(PLACED, store, PLACED[3]);
    expect(reRun).toEqual({ id: "5-grid", moduleId: "grid" });
  });
});


describe("repair appends the affected tail to a fixpoint — and only the affected tail", () => {
  it("re-runs the producer of the terminal's missing port, and skips the untouched middle", async () => {
    const store = createStore(seed());
    await fillAll(store);
    const run = createEngine(store).runModule;

    // The change pruned grid's output; save is now blocked on its required `buildings`.
    store.applyTransaction([], [
      { op: "remove", path: "/buildings", prev: fc([building("b1")]) },
    ]);
    expect(store.data.buildings).toBeUndefined();

    const appended = await repair(PLACED, registry, store, run, "save");

    expect(appended).toEqual(["5-grid"]);
    expect(store.data.buildings).toEqual(fc([building("b1")]));
    // `settings` writes a port nothing downstream reads — it is never re-run.
    expect(store.log.every((commit) => commit.node?.id !== "2-settings")).toBe(true);
  });

  it("iterates to a fixpoint: repairs a producer's own missing input first", async () => {
    const store = createStore(seed());
    await fillAll(store);
    const run = createEngine(store).runModule;

    // Both draw's output and grid's output are gone: repair must re-run draw before grid.
    store.applyTransaction([], [
      { op: "remove", path: "/coordinates", prev: [[[8.6, 49.4]]] },
      { op: "remove", path: "/buildings", prev: fc([building("b1")]) },
    ]);

    const appended = await repair(PLACED, registry, store, run, "save");

    expect(appended).toEqual(["5-draw", "6-grid"]);
    expect(store.data.coordinates).toEqual([[[8.6, 49.4]]]);
    expect(store.data.buildings).toEqual(fc([building("b1")]));
  });

  it("does nothing when the terminal is already runnable", async () => {
    const store = createStore(seed());
    await fillAll(store);
    const run = createEngine(store).runModule;

    expect(await repair(PLACED, registry, store, run, "save")).toEqual([]);
  });

  it("stops rather than throwing when nothing produces a missing port", async () => {
    const store = createStore(seed());
    await fillAll(store);
    const run = createEngine(store).runModule;

    const orphan = [{ id: "0-save", moduleId: "save" }];
    // No upstream placement in this transcript can produce `buildings`.
    expect(await repair(orphan, registry, store, run, "save")).toEqual([]);
  });
});
