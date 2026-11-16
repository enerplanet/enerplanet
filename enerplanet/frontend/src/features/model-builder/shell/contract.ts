/**
 * The shell's front door to the contracts it works with (`Plan.md` §8).
 *
 * The types themselves now live in the core — `core/view.ts` holds what a host hands a module
 * (`BuilderModule`, `ModuleViewProps`, `MapService`), and `core/module.ts` holds the regions — because a
 * module has to be able to import them without depending on a particular host. The shell is one host;
 * the workflow will be another.
 *
 * This file stays as re-exports so nothing in `shell/` reaches into the core by a path that could drift,
 * and so the shell keeps one import site for the whole contract.
 */

export { REGIONS, isHostModule } from "../core/module";
export type { Region, NodeState, Module } from "../core/module";
export type {
  BuilderModule,
  LayerOptions,
  MapClick,
  MapFeature,
  MapHost,
  MapService,
  ModuleViewProps,
  OverlayControl,
} from "../core/view";
