/**
 * The shell's front door to the contracts it works with.
 *
 * Re-exports, so nothing in `shell/` reaches into the core by a path that could drift.
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
