/**
 * A test-only stand-in for the interactive example module, for the shell's own suites.
 */

import { defineModule, type ModelData } from "@model-builder/core";
import type { BuilderModule } from "./contract";

/** The module's own collected values, keyed to the node they were collected for. */
const held: { nodeId: string | null; values: Partial<ModelData> } = { nodeId: null, values: {} };

/** Hold these values for `nodeId`, dropping anything held for a different node. */
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

    // Read before write, and commit only a real change — a padded name trims to a new value.
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
