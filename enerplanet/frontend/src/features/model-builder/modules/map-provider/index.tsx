/**
 * `map-provider` — the always-loaded basemap host (`modules/map-provider.md`).
 *
 * *"required · always loaded · not a workflow node · blackbox"*. It renders nothing of its own and writes
 * nothing to the store: the frame loads it once, mounts the canvas it hands over into the `map` slot, and gives
 * every module the `MapService` out of it. This is the seam that makes the map engine swappable, and the reason
 * no module ever imports MapLibre.
 *
 * The engine is **MapLibre** — 2D and 3D from one renderer (`modules/README.md`). The split inside is between
 * what can be reasoned about without a browser (`mapHost.ts`, tested in node) and what cannot
 * (`mapCanvas.tsx`, deliberately not unit-tested).
 */

import { defineModule, type BuilderModule, type MapHost } from "@model-builder/core";
import { createHostRuntime } from "./mapHost";
import { MapCanvas } from "./mapCanvas";

const module = defineModule({
  id: "map-provider",
  name: "Map provider",

  // It writes nothing, and that is not an omission: the map is a transient interaction service, and this
  // module exists to *provide* it, not to fill the store (`Modules.md` §2, the swap rule).
  params: [],
  affect: {},

  // Headless. A module that declares no region renders nothing — which is exactly what a provider looks like:
  // the frame mounts the canvas from `createMapHost`, so there is no slot here to fill.
  layout: [],

  // A provider has no work of its own, and it is never placed in a flow, so this is never called.
  run: () => undefined,
  validate: () => [],
});

/** No region is declared, so there is no UI to render. */
const Component: BuilderModule["Component"] = () => null;

/**
 * The host the frame mounts: the canvas, plus the service it implements.
 *
 * The service is **stable from creation** — real before the canvas has rendered anything — so a module that
 * touches the map on its first render is not racing the map. Call this **once** per frame (memoise it): the
 * canvas component it returns is identified by that call.
 */
export function createMapHost(): MapHost {
  const runtime = createHostRuntime();

  return {
    Canvas: () => <MapCanvas runtime={runtime} />,
    service: runtime.service,
  };
}

const builderModule: BuilderModule = { module, Component };

export default builderModule;
