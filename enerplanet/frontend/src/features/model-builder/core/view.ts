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
 * The map service a module in the `map` region gets (`Plan.md` §8).
 *
 * The map is a **transient interaction service, not model state**: it holds render/interaction state
 * only, and anything a module must keep (a drawn polygon, a selection) is committed to the store as a
 * normal transaction instead. The map host never writes the store.
 */
export interface MapService {
  /** The baselayer provider this host is rendering, or `undefined` when none is loaded yet. */
  readonly providerId?: string;
  addLayer(id: string, layer: unknown): void;
  removeLayer(id: string): void;
  fitTo(geometry: unknown): void;
  requestPoint(): Promise<[number, number]>;
  requestPolygon(): Promise<[number, number][][]>;
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
