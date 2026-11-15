/**
 * The modules the shell hosts.
 *
 * A **manual, hand-written list** — deliberately, and only for now. Modules are built one at a time in
 * isolation, so a registry they are added to by hand is honest about where the project is: there is no
 * workflow to resolve them from yet. Adding a module is an import and an entry; nothing else in the
 * feature has to change.
 *
 * One entry per line, so `scripts/new-module.mjs` can splice a new module in without guessing.
 */

import type { BuilderModule, MapHost } from "./contract";
import example from "../modules/example";

import modelStart from "../modules/model-start";

import mapProvider, { createMapHost } from "../modules/map-provider";

import areaDraw from "../modules/area-draw";

import gridGeneration from "../modules/grid-generation";

import modelSave from "../modules/model-save";

export const MODULES: readonly BuilderModule[] = [
  example,
  modelStart,
  mapProvider,
  areaDraw,
  gridGeneration,
  modelSave,
];

/**
 * The module that provides the map, and how the frame builds the host it mounts.
 *
 * A **host module** is not a workflow node (`modules/map-provider.md`): the frame loads it once, because the
 * map is always there, and hands every module's `map` region the service out of it. This constant is the
 * frame's *entire* knowledge of the provider — swap the module and the frame does not change.
 */
export const MAP_PROVIDER: { readonly id: string; readonly createHost: () => MapHost } = {
  id: "map-provider",
  createHost: createMapHost,
};
