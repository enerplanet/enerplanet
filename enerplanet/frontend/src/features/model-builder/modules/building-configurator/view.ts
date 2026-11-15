/**
 * The building configurator's host seam — the slot the shell fills.
 *
 * The package (`@thd-spatial-ai/building-configurator`) is a **view, not a store client**: it takes a building,
 * its geometry and a set of services, and hands back an edited state. Everything it needs to be *fed* —
 * geometry from the 3D dataset, the demand profile, the PV machinery, the catalogue-backed products — lives in
 * the app's configurator, which is **not** the module's to import: a module may only depend on
 * `@model-builder/core`.
 *
 * So the module owns the part that is *its* job — the opening, the picking, and the committing — and asks the
 * shell for the view itself. The shell installs a component that wraps `Building3DView` with whatever glue it
 * has; the module renders that component and never learns what is inside it. This is the same shape as
 * `setGridEngine` and `setWeatherSource`, and it is what keeps the package swappable.
 *
 * The typed-in `ComponentType` is deliberate: the module hands over exactly what any building view would need,
 * so a different one — or a stub in a test — can stand in without the module changing.
 */

import type { ComponentType } from "react";

import type { BuildingParams, TechAssignment } from "@model-builder/core";

/** What a view hands back when it closes with a change. */
export interface BuildingEdit {
  /** The building's demand parameters, if the user touched them. */
  params?: BuildingParams;
  /** The building's technologies, if the user touched them. */
  technologies?: TechAssignment[];
}

/** What the module hands a view. Everything the view needs, and nothing about the store. */
export interface BuildingViewProps {
  /** The building's `osm_id` — how the store keys it. */
  osmId: string;
  /** The building feature itself, so the view has its properties without asking. */
  feature: GeoJSON.Feature;
  /** What the store already holds for this building — where the view starts. */
  params?: BuildingParams;
  technologies?: TechAssignment[];
  /**
   * The view closed with a change. **The module commits it**, on its own transaction — the host must not write
   * the store, and nothing is written while the view is open, so an abandoned overlay changes nothing.
   */
  onCommit: (edit: BuildingEdit) => void;
  /** The view closed without a change. */
  onClose: () => void;
}

/** The installed building view. */
export interface BuildingConfigurator {
  readonly View: ComponentType<BuildingViewProps>;
}

let installed: BuildingConfigurator | null = null;

/** Install the building configurator. Called by the shell at startup; `null` clears it. */
export function setBuildingConfigurator(next: BuildingConfigurator | null): void {
  installed = next;
}

/** The installed configurator, or null while the host has installed nothing (as in a test). */
export function buildingConfigurator(): BuildingConfigurator | null {
  return installed;
}
