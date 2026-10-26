/**
 * What a saved model keeps for a building edited in the configurator, under
 * the building's properties.buem.
 *
 * building and solver are BuEM's own blocks, the ones the configurator's run
 * sends, so the backend's model run can send them unchanged. construction_year,
 * refurbishment and outputs are not part of either block; they are kept beside
 * them so reopening the building shows them again.
 */

import { adaptBuemFeature, toBuem, type BuildingState } from '@thd-spatial-ai/building-configurator';

export type StoredBuem = ReturnType<typeof toBuem>;

export function toStoredBuem(state: BuildingState): StoredBuem {
  return toBuem(state);
}

/** The stored buem of a building feature, or null when it was never edited. */
export function storedBuemOf(properties: Record<string, unknown> | undefined): StoredBuem | null {
  const stored = properties?.buem as StoredBuem | undefined;
  return stored?.building ? stored : null;
}

/**
 * Rebuilds the configurator's state for a building from what was stored.
 * storeys is City2TABULA's count, used when the stored block has none.
 */
export function fromStoredBuem(osmId: string, geometry: unknown, stored: StoredBuem, storeys?: number): BuildingState {
  // Models saved with configurator 0.7 carry technology_state; PV now lives in the building's techs.
  const { technology_state: _legacy, ...buem } = stored as StoredBuem & { technology_state?: unknown };
  // Configurator 0.14 keeps the count beside the block; earlier versions saved none.
  const saved = (buem as { storeys?: number }).storeys ?? buem.building.n_storeys;
  const building = saved === undefined && storeys ? { ...buem.building, n_storeys: storeys } : buem.building;
  return adaptBuemFeature({ type: 'Feature', id: osmId, geometry, properties: { buem: { ...buem, building } } });
}
