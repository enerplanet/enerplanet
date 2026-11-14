/**
 * The **view contract**: what a host hands a module, and how a module is bound to its UI (`Plan.md` §8).
 *
 * This lives in the core rather than in the shell because a module must be able to import it without
 * depending on any particular host. The shell is one host; the workflow will be another; a test harness
 * is a third. What they have in common is exactly this file.
 *
 * A module here is two things bound together: the **core contract** (`Module` — declared ports,
 * `affect`, `run`, `validate`) and its **UI**. The host places the UI into the regions the module
 * declares, so a module carries no page-level layout knowledge — it says *where* it renders, and the
 * host decides how the page is composed. That split is what lets the layout change (a responsive
 * frame, another set of region names, an embedded host) without touching a module.
 *
 * The React imports are **type-only** on purpose: this package ships no runtime code that needs React,
 * so a module's `Component` is typed here without the core depending on React at runtime.
 */

import type { ComponentType } from "react";
import type { Module, Region } from "./module";
import type { ModelData } from "./ports";

/**
 * A feature the map handed back: its geometry, and **the data connected to it**.
 *
 * This is the point of the map service. A consumer asks the map for a point, a polygon or a clicked element,
 * and gets back the feature *and* whatever the provider holds for it. A bare coordinate would make a consumer
 * go back to the map engine to look the feature up, which is exactly the dependency the provider exists to
 * hide (`modules/map-provider.md`, "blackbox"). The geometry travels as GeoJSON so a module can commit it to
 * the store without importing the map engine at all.
 */
export interface MapFeature {
  /** The feature's own data, as the provider holds it. Read-only: the provider owns it, not the consumer. */
  readonly properties: Readonly<Record<string, unknown>>;
  /** Its geometry as GeoJSON — absent when the provider has no geometry for it. */
  readonly geometry?: GeoJSON.Geometry;
}

/** What the map publishes when the user clicks, so a listener can react to it. */
export interface MapClick {
  /** Where they clicked, `[lon, lat]`. */
  readonly coordinates: [number, number];
  /** The element they hit — **absent when the click landed on empty map**, which is an answer, not an error. */
  readonly feature?: MapFeature;
}

/** What a layer is created with. */
export interface LayerOptions {
  /** Whether this layer starts out accepting clicks. Only one layer is interactive at a time. */
  readonly interactive?: boolean;
}

/**
 * The map service a module in the `map` region gets (`Plan.md` §8, `modules/map-provider.md`).
 *
 * The map is a **transient interaction service, not model state**: it holds render/interaction state only, and
 * anything a module must keep (a drawn polygon, a selection) is committed to the store as a normal transaction
 * instead. The map host never writes the store.
 *
 * The shape of the work is **create, then place**: asking the map for geometry *returns* it and puts nothing on
 * the map; the module then names a layer and adds what it created. Building something and showing it are two
 * calls, so a module can commit what it built before it decides to draw it — or not draw it at all.
 */
export interface MapService {
  // ── Creating geometry. Nothing is on the map yet; the result goes onto a layer with `addFeatures`.

  /** **A** — let the user create a point, and return it. */
  requestPoint(): Promise<MapFeature>;
  /** **B** — let the user create a polygon (rings of `[lon, lat]`), and return it. */
  requestPolygon(): Promise<MapFeature>;

  // ── Reacting to the user.

  /**
   * **C** — subscribe to clicks on the map. `undefined` is passed when the click missed every interactive
   * layer, so a module can react to both "they picked this element" and "they clicked the map".
   *
   * Returns the **unsubscribe**: a listener outliving the module that registered it is a leak, and this is the
   * handle that stops it.
   */
  onElementClick(listener: (click: MapClick) => void): () => void;

  // ── Layers. A module **names its own layer** — the id is how it finds it again, and how `getLayerOrder`
  //    talks about it.

  /** **D** — create the layer with this id, or adopt the one that already has it (idempotent). */
  createLayer(id: string, options?: LayerOptions): void;
  /**
   * Remove the layer entirely. *Not in the A–H list, but not omittable*: a module that leaves must be able to
   * take its layer with it, and a provider is expected to drop what a departed module left behind anyway.
   * **Idempotent** — removing a layer that is not there does nothing, so a cleanup path can always call it.
   */
  removeLayer(id: string): void;
  /**
   * **E** — add geometry to a layer: a `MapFeature` straight from `requestPoint`/`requestPolygon`, or any
   * GeoJSON. A feature's **properties travel with it** and come back on `onElementClick` — that is the
   * "connected data" the map is for.
   */
  addFeatures(id: string, data: GeoJSON.GeoJSON | MapFeature): void;
  /**
   * Empty a layer without removing it. *Not in the A–H list*: a module redraws its result layer whenever the
   * store changes, and without this it could only ever append.
   */
  clearLayer(id: string): void;

  /**
   * **F** — which layer is up front and accepts clicks; `null` for none.
   *
   * The designated layer renders in front of the others, and **the stored order is left alone** — so
   * designating another layer, or none, puts the stack back exactly as it was, which is what "initial order is
   * preserved" means.
   */
  setInteractiveLayer(id: string | null): void;

  /** **G** — the layer order, bottom to top, as a plain array of ids. */
  getLayerOrder(): readonly string[];
  /**
   * **H** — put the layers in this order: hand back what `getLayerOrder` returned, reordered.
   *
   * Strict on purpose — the list must name every layer exactly once. A module that wants to move one layer
   * reorders the list it just read, and a list naming a layer the host does not have is a bug worth hearing
   * about rather than a silently ignored call.
   */
  setLayerOrder(order: readonly string[]): void;

  /**
   * Frame this geometry (GeoJSON). *Not in the A–H list*: `model-start` already frames the chosen region with
   * it, and a provider that cannot move its camera is not a camera.
   */
  fitTo(geometry: GeoJSON.GeoJSON): void;
}

/**
 * What the frame mounts for the map (`modules/map-provider.md`).
 *
 * A **host module** is not a workflow node and has no place in a flow: the frame loads it once, because the
 * map is always there, and hands every module's `map` region the service out of it. The provider is swappable
 * by design, and this is the seam that makes it so — the frame knows only this shape, never MapLibre or
 * OpenLayers.
 *
 * The service is **stable from creation**, before the canvas has rendered anything: a module that creates a
 * layer on its first render is not racing the map.
 */
export interface MapHost {
  /** The canvas, and nothing else — the frame hands it the slot, and it fills it. */
  readonly Canvas: ComponentType;
  /** The service every module's `map` region is handed. */
  readonly service: MapService;
}

/**
 * The overlay slot's control, handed to a module that declared the `overlay` region.
 *
 * A full-screen slot needs an open/closed state, and the **host owns the chrome** — the scrim, the
 * centring, the Escape handling — so the module asks the host to open or close it rather than rendering
 * a full-screen div of its own. This is transient *view* state, exactly like the map: it is not model
 * state, and it is not committed to the store.
 */
export interface OverlayControl {
  readonly isOpen: boolean;
  open(): void;
  close(): void;
}

/** What a module's UI is handed on every render. */
export interface ModuleViewProps {
  /**
   * The id of the node this render belongs to — stamp it on anything the module commits.
   *
   * In **test mode** there is no node: the frame is showing one module on its own, so this is the module id,
   * and it is a label rather than something to stamp.
   */
  nodeId: string;
  /** Which region this render is for: the module renders once per region it declared. */
  region: Region;
  /** The projection, read-only. The store is the only state a module has. */
  data: Readonly<ModelData>;
  /** Run this module through the engine. Its own `run()` decides what to commit, so the write
   *  boundary, anti-clobber and the cascade all apply exactly as they do in the flow. */
  run: () => Promise<void>;
  /** Present only when the module declared the `map` region. */
  map?: MapService;
  /** Present only when the module declared the `overlay` region. */
  overlay?: OverlayControl;
}

/** A module as a host loads it. */
export interface BuilderModule {
  /** The core contract. `module.layout` names the regions its UI mounts into. */
  module: Module;
  /** The UI: one component, rendered once per declared region. */
  Component: ComponentType<ModuleViewProps>;
  /**
   * The module's **test data**: the inputs it needs to be developed and tested in isolation.
   *
   * In *test mode* — the module loaded on its own, in its workspace or the module preview — this seeds the
   * scratch store before `run()`, so nothing has to pre-exist. That is not the `required` gate weakened:
   * it is satisfied by construction, and the contract check asserts this data covers every port the module
   * declares `required`.
   */
  mock?: Partial<ModelData>;
}
