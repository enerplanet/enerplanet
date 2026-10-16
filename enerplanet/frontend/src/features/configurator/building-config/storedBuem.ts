/**
 * What a saved model keeps for a building edited in the configurator, under
 * the building's properties.buem.
 *
 * building and solver are BuEM's own blocks, the ones the configurator's run
 * sends, so the backend's model run can send them unchanged. PV arrays and the
 * battery are not part of either BuEM block; technology_state carries them so
 * reopening the building shows them again.
 */

import {
  adaptBuemFeature,
  toBuem,
  type BuildingState,
  type SurfacePolygon,
  type TechnologyState,
} from '@thd-spatial-ai/building-configurator';

export interface StoredBuem {
  building: Record<string, unknown>;
  solver: { use_milp: boolean };
  technology_state?: TechnologyState;
}

export function toStoredBuem(state: BuildingState): StoredBuem {
  return { ...toBuem(state), technology_state: state.technologyState };
}

/** The stored buem of a building feature, or null when it was never edited. */
export function storedBuemOf(properties: Record<string, unknown> | undefined): StoredBuem | null {
  const stored = properties?.buem as StoredBuem | undefined;
  return stored?.building ? stored : null;
}

/** Rebuilds the configurator's state for a building from what was stored. */
export function fromStoredBuem(osmId: string, geometry: unknown, stored: StoredBuem): BuildingState {
  const { technology_state: technologyState, ...buem } = stored;
  const state = adaptBuemFeature({ type: 'Feature', id: osmId, geometry, properties: { buem } });
  return technologyState ? { ...state, technologyState } : state;
}

/**
 * True when not one surface resolves to an element of the stored envelope: the
 * edits were saved against surface ids City2TABULA no longer serves. A partial
 * miss is normal, since a ClosureSurface never has an element.
 */
export function editsDetached(building: BuildingState, surfaces: SurfacePolygon[]): boolean {
  return surfaces.length > 0 && !surfaces.some((s) => Object.hasOwn(building.envelope, s.id));
}
