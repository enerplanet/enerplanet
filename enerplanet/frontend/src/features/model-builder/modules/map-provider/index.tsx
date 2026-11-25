/**
 * `map-provider` — the always-loaded basemap host. Renders nothing of its own and writes nothing to the store;
 * the frame mounts its canvas into the `map` slot and gives every module the `MapService`. The engine is
 * MapLibre. Split: `mapHost.ts` (testable in node) and `mapCanvas.tsx` (deliberately not unit-tested).
 */

import { defineModule, type BuilderModule, type MapHost } from "@model-builder/core";
import { createHostRuntime } from "./mapHost";
import { MapCanvas } from "./mapCanvas";

const module = defineModule({
  id: "map-provider",
  name: "Map provider",

  // It writes nothing: the map is a transient interaction service this module provides, not store state.
  params: [],
  affect: {},

  // Headless. A provider declares no region; the frame mounts the canvas from `createMapHost`.
  layout: [],

  // A provider has no work of its own, and it is never placed in a flow, so this is never called.
  run: () => undefined,
  validate: () => [],
});

/** No region is declared, so there is no UI to render. */
const Component: BuilderModule["Component"] = () => null;

/** The host the frame mounts: the canvas, plus the service it implements. Call once per frame (memoise it). */
export function createMapHost(): MapHost {
  const runtime = createHostRuntime();

  return {
    Canvas: () => <MapCanvas runtime={runtime} />,
    service: runtime.service,
  };
}

const builderModule: BuilderModule = { module, Component };

export default builderModule;
