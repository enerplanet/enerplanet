/**
 * What a saved model keeps for a building edited in the configurator, under
 * the building's properties.buem.
 *
 * building and solver are BuEM's own blocks, the ones the configurator's run
 * sends, so the backend's model run can send them unchanged. configurator
 * (construction year, storeys, storey list), refurbishment and outputs are not
 * part of either block; they are kept beside them so reopening the building
 * shows them again.
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
  // 0.15 keeps the count under configurator, 0.14 beside the block; earlier versions saved none.
  const saved = buem.configurator?.storeys ?? (buem as { storeys?: number }).storeys ?? buem.building.n_storeys;
  const building = saved === undefined && storeys ? { ...buem.building, n_storeys: storeys } : buem.building;
  return adaptBuemFeature({ type: 'Feature', id: osmId, geometry: locationPoint(geometry), properties: { buem: { ...buem, building } } });
}

/**
 * The footprint's first vertex as a point: the configurator reads a building's
 * location from geometry.coordinates as [lon, lat], so a polygon would reach it as no location.
 */
function locationPoint(geometry: unknown): unknown {
  let node = (geometry as { coordinates?: unknown } | undefined)?.coordinates;
  while (Array.isArray(node) && Array.isArray(node[0])) node = node[0];
  return Array.isArray(node) ? { type: 'Point', coordinates: node } : geometry;
}
