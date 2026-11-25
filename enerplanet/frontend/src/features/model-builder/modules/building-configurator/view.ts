/**
 * The building configurator's host seam — the slot the shell fills.
 *
 * The package is a view, not a store client: it takes a building, its geometry and a set of services, and
 * hands back an edited state. The module owns the opening, picking and committing, and asks the shell for the
 * view itself (which the shell wraps around `Building3DView`). Same shape as `setGridEngine`.
 */

import type { ComponentType } from "react";

import type { BuildingParams, TechAssignment } from "@model-builder/core";

/** What a view hands back when it closes with a change. */
export interface BuildingEdit {
  /** The building's demand parameters, if the user touched them. */
  params?: BuildingParams;
  /** The building's technologies, if the user touched them. */
  technologies?: TechAssignment[];
  /** The legacy configurator's envelope/thermal block, kept on the feature as `properties.buem`; not a port. */
  buem?: unknown;
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
  /** The session's draft id, read from the store. */
  draftId?: string;
  /** The grid this building lives in; absent in a test. */
  grid?: {
    buildings?: GeoJSON.FeatureCollection;
    lines?: GeoJSON.FeatureCollection;
    mvLines?: GeoJSON.FeatureCollection;
    transformers?: GeoJSON.FeatureCollection;
    grids?: unknown;
  };
  /** The view closed with a change. The module commits it, on its own transaction; nothing is written while the view is open. */
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
