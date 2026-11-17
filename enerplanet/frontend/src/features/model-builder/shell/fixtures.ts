/**
 * A test-only stand-in for the interactive example module, for the shell's own suites.
 *
 * The two example modules moved to `modules/examples/` and are no longer registered, so a shell suite that
 * wants *a* module — to place as a node, to run for real, or to read a node id off — needs one from here
 * rather than from the templates. It mirrors the interactive example's shape: a couple of declared ports, the
 * module-scope `hold` seam a region hands values through, and a `run()` that reads before it writes and
 * commits only what differs (trimming the name, so the padded seeds those suites use produce a real diff).
 *
 * Its id stays `"example"`: the suites assert it as a node's module id and as the registry key, and it is the
 * one module they place twice. Not a live module — never imported by a non-test file.
 *
 * Kept here, not in `core/fixtures.ts`: that file holds data factories and is deliberately free of shared
 * mutable state, while this fixture carries the `hold` seam and its consumers are shell tests.
 */

import { defineModule, type ModelData } from "@model-builder/core";
import type { BuilderModule } from "./contract";

/**
 * The module's own collected values, keyed to the node they were collected for — the example's pattern: a
 * value collected on one node must never be committed against another.
 */
const held: { nodeId: string | null; values: Partial<ModelData> } = { nodeId: null, values: {} };

/**
 * Hold these values for `nodeId`, dropping anything held for a different node. The only way a suite hands a
 * run its values, exactly as a region does.
 */
export function hold(nodeId: string, values: Partial<ModelData> = {}): void {
  if (held.nodeId !== nodeId) {
    held.values = {};
    held.nodeId = nodeId;
  }
  Object.assign(held.values, values);
}

/** Take what is held and leave nothing behind: a hold describes one gesture, not a pending state. */
function takeHeld(): Partial<ModelData> {
  const values = held.values;
  held.values = {};
  held.nodeId = null;
  return values;
}

const module = defineModule({
  id: "example",
  name: "Shell fixture",

  // A couple of ports — enough to be a real node, and the two the suites seed.
  params: [{ port: "modelName" }, { port: "resolution" }],

  affect: {},
  layout: [],

  run: (ctx) => {
    const collected = takeHeld();
    const proposed: Partial<ModelData> = {};

    // Read before write, and commit only a real change. A padded name trims to a value the store does not
    // hold yet, which is the diff the suites rely on.
    if (collected.modelName !== undefined) {
      const current = ctx.read("modelName");
      const trimmed = collected.modelName.trim();
      if (trimmed !== current) proposed.modelName = trimmed;
    }

    if (collected.resolution !== undefined) {
      const current = ctx.read("resolution");
      if (collected.resolution !== current) proposed.resolution = collected.resolution;
    }

    ctx.commit(proposed);
  },

  validate: ({ store }) =>
    store.modelName === undefined || store.modelName.trim().length === 0
      ? [{ port: "modelName", message: "The model needs a name." }]
      : [],
});

const builderModule: BuilderModule = {
  module,
  Component: () => null,
  mock: { modelName: "Fixture model", resolution: 60 },
};

export default builderModule;
