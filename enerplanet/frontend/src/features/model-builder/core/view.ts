/**
 * The view contract: what a host hands a module, and how a module is bound to its UI.
 *
 * It lives in the core so a module can import it without depending on any particular host. A module here
 * is the core contract (`Module`) bound to its UI; the host places the UI into the regions the module
 * declares. The React imports are type-only on purpose — the package ships no runtime code that needs React.
 */

import type { ComponentType } from "react";
import type { Module, Region } from "./module";
import type { ModelData } from "./ports";

/** A feature the map handed back: its geometry, and the data connected to it (geometry travels as GeoJSON). */
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

/** A module layer's volume: how tall its polygons stand, and in what colour. */
export interface LayerExtrusion {
  /** A feature property holding the height in metres; a feature without one gets `fallback`. */
  readonly heightFrom?: string;
  /** Height in metres for a feature that has no height of its own. */
  readonly fallback: number;
  /** The volume's colour — what makes one extruded layer read as a single thing. */
  readonly color: string;
}

/** What a layer is created with. */
export interface LayerOptions {
  /** Whether this layer starts out accepting clicks. Only one layer is interactive at a time. */
  readonly interactive?: boolean;
  /** Draw this layer's polygons as volumes rather than flat fills. Only polygons; points and lines are unaffected. */
  readonly extrusion?: LayerExtrusion;
  /**
   * The layer's colour — its fill, outline and points — when it should read differently from the provider's
   * default. A module names a colour, not a fill or a stroke; how it is applied is the provider's business.
   */
  readonly color?: string;
  /** Render this layer above the interactive one, so an annotation drawn over it stays visible. */
  readonly onTop?: boolean;
}

/**
 * The map service a module in the `map` region gets — a transient interaction service, not model state.
 *
 * The shape of the work is create, then place: asking for geometry returns it and puts nothing on the map,
 * and the module then names a layer and adds what it created.
 */
export interface MapService {
  // ── Creating geometry. Nothing is on the map yet; the result goes onto a layer with `addFeatures`.

  /** Let the user create a point, and return it. */
  requestPoint(): Promise<MapFeature>;
  /** Let the user create a polygon (rings of `[lon, lat]`), and return it. */
  requestPolygon(): Promise<MapFeature>;

  // ── Reacting to the user.

  /**
   * Subscribe to clicks on the map; `undefined` is passed when the click missed every interactive layer.
   * Returns the unsubscribe.
   */
  onElementClick(listener: (click: MapClick) => void): () => void;

  // ── Layers. A module **names its own layer** — the id is how it finds it again, and how
  //    `getLayerOrder` talks about it.

  /** Create the layer with this id, or adopt the one that already has it (idempotent). */
  createLayer(id: string, options?: LayerOptions): void;
  /** Remove the layer entirely. Idempotent — removing a layer that is not there does nothing. */
  removeLayer(id: string): void;
  /** Add geometry to a layer; a feature's properties travel with it and come back on `onElementClick`. */
  addFeatures(id: string, data: GeoJSON.GeoJSON | MapFeature): void;
  /** Empty a layer without removing it: a module redraws its result layer whenever the store changes. */
  clearLayer(id: string): void;

  /** Which layer is up front and accepts clicks; `null` for none. Leaves the stored order alone. */
  setInteractiveLayer(id: string | null): void;

  /** The layer order, bottom to top, as a plain array of ids. */
  getLayerOrder(): readonly string[];
  /** Put the layers in this order — strict: the list must name every layer exactly once. */
  setLayerOrder(order: readonly string[]): void;

  /** Frame this geometry (GeoJSON). A provider that cannot move its camera is not a camera. */
  fitTo(geometry: GeoJSON.GeoJSON): void;
}

/**
 * What the frame mounts for the map: the canvas, and the service every module's `map` region is handed.
 *
 * A host module is not a workflow node: the frame loads it once and hands out its service. The service is
 * stable from creation, before the canvas has rendered anything.
 */
export interface MapHost {
  /** The canvas, and nothing else — the frame hands it the slot, and it fills it. */
  readonly Canvas: ComponentType;
  /** The service every module's `map` region is handed. */
  readonly service: MapService;
}

/**
 * The overlay slot's control, handed to a module that declared the `overlay` region. Transient view state,
 * not model state — the host owns the chrome.
 */
export interface OverlayControl {
  readonly isOpen: boolean;
  open(): void;
  close(): void;
}

/**
 * An auto node's own run state, handed to the module that renders it. The frame runs it on arrival; the
 * only control it offers is a manual re-run, and only on `error`.
 */
export interface AutoRunState {
  /** `running` while the frame's run is in flight, `done` once it landed, `error` when it threw. */
  state: "running" | "done" | "error";
  /** The failure, when `state` is `error` — what the frame caught. */
  message?: string;
  /** Ask the frame to run this node again — the only affordance an auto node has, and only on `error`. */
  rerun(): void;
}

/** What a module's UI is handed on every render. */
export interface ModuleViewProps {
  /** The id of the node this render belongs to — stamp it on anything the module commits. */
  nodeId: string;
  /** Which region this render is for: the module renders once per region it declared. */
  region: Region;
  /** The projection, read-only. The store is the only state a module has. */
  data: Readonly<ModelData>;
  /** Run this module through the engine. Its own `run()` decides what to commit, so the write boundary,
   *  anti-clobber and the cascade apply exactly as they do in the flow. */
  run: () => Promise<void>;
  /** Present only when the module declared the `map` region. */
  map?: MapService;
  /** Present only when the module declared the `overlay` region. */
  overlay?: OverlayControl;
  /** Present only while the session sits on an `auto` node — the run's state and its manual retry. */
  auto?: AutoRunState;
}

/** A module as a host loads it. */
export interface BuilderModule {
  /** The core contract. `module.layout` names the regions its UI mounts into. */
  module: Module;
  /** The UI: one component, rendered once per declared region. */
  Component: ComponentType<ModuleViewProps>;
  /** The module's test data: the inputs it needs to be developed and tested in isolation. */
  mock?: Partial<ModelData>;
}
