/**
 * The modules the shell hosts.
 *
 * A manual, hand-written list — one entry per line, so `scripts/new-module.mjs` can splice a new module in.
 */

import type { BuilderModule, MapHost } from "./contract";

import modelStart from "../modules/model-start";

import mapProvider, { createMapHost } from "../modules/map-provider";

import areaDraw from "../modules/area-draw";

import gridGeneration from "../modules/grid-generation";

import modelSave from "../modules/model-save";

import weather from "../modules/weather";

import buildingDemand from "../modules/building-demand";

import buildingConfigurator from "../modules/building-configurator";
import technologies from "../modules/technologies";

import runMemeCalliope from "../modules/run-meme-calliope";

import runMemePypsa from "../modules/run-meme-pypsa";

import resultOverview from "../modules/result-overview";

import modelVariant from "../modules/model-variant";

import compareVariant from "../modules/compare-variant";

export const MODULES: readonly BuilderModule[] = [
  modelStart,
  mapProvider,
  areaDraw,
  gridGeneration,
  modelSave,
  weather,
  buildingDemand,
  buildingConfigurator,
  technologies,
  runMemeCalliope,
  runMemePypsa,
  resultOverview,
  modelVariant,
  compareVariant,
];

/** The module that provides the map, and how the frame builds the host it mounts. */
export const MAP_PROVIDER: { readonly id: string; readonly createHost: () => MapHost } = {
  id: "map-provider",
  createHost: createMapHost,
};

/** How the frame hands the save node its session. */
export { bindModelSaveSession } from "../modules/model-save";
