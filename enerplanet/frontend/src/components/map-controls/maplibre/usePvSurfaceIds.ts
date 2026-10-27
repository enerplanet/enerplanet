import { useEffect, useState } from 'react';

import axios from '@/lib/axios';
import type { BuildingTechs } from '@/features/configurator/building-config/buildingTechnologies';
import { installedPvArrays, type PvSurfaceRow } from '@/features/configurator/building-config/usePvMode';

import { forEachLimited } from './useLod2Surfaces';

/** A building's technologies by osm_id; without it they are read from the building's `techs` property. */
export type TechsFor = (osmId: string) => BuildingTechs | null;

// A building's PV surfaces do not change while the page is open, so they are
// fetched once per building, as the LoD2 surfaces are.
const rowCache = new Map<string, Promise<PvSurfaceRow[]>>();

function pvRowsFor(country: string, osmId: string): Promise<PvSurfaceRow[]> {
  const key = `${country}:${osmId}`;
  let request = rowCache.get(key);
  if (!request) {
    request = axios
      .get<{ surfaces: PvSurfaceRow[] }>('/v1/city2tabula/pv-surfaces', { params: { osm_id: osmId, country } })
      .then((res) => res.data.surfaces);
    request.catch(() => rowCache.delete(key));
    rowCache.set(key, request);
  }
  return request;
}

/** Each PV building's stored surface ids, or null while its placement is automatic. */
export function pvBuildingsOf(buildings: GeoJSON.FeatureCollection | null, techsFor?: TechsFor): [string, string[] | null][] {
  const out: [string, string[] | null][] = [];
  for (const f of buildings?.features ?? []) {
    const osmId = String(f.properties?.osm_id ?? '').trim();
    if (!osmId) continue;
    const techs: BuildingTechs | null | undefined = techsFor ? techsFor(osmId) : f.properties?.techs;
    const pv = techs?.pv_supply;
    if (pv) out.push([osmId, pv.arrays ? pv.arrays.map((a) => a.surface_id) : null]);
  }
  return out;
}

/**
 * The surfaces carrying PV, by osm_id: a building's stored arrays, or while
 * its placement is automatic the qualifying roofs, as the building
 * configurator places them. Re-read on every render, so an edit shows when the
 * page renders again.
 */
export function usePvSurfaceIds(buildings: GeoJSON.FeatureCollection | null, techsFor: TechsFor | undefined, country: string | null): Map<string, Set<string>> {
  const [byOsmId, setByOsmId] = useState<Map<string, Set<string>>>(() => new Map());
  // One feature lookup per building per render, quadratic with the configurator's techsFor; index the features if large models lag.
  const key = JSON.stringify(pvBuildingsOf(buildings, techsFor));

  useEffect(() => {
    let cancelled = false;
    const found = new Map<string, Set<string>>();
    const automatic: string[] = [];
    for (const [osmId, ids] of JSON.parse(key) as [string, string[] | null][]) {
      if (ids) found.set(osmId, new Set(ids));
      else automatic.push(osmId);
    }
    setByOsmId(new Map(found));
    if (!country || automatic.length === 0) return;
    void forEachLimited(automatic, async (osmId) => {
      try {
        const rows = await pvRowsFor(country, osmId);
        found.set(osmId, new Set(installedPvArrays(null, rows).map((a) => a.surface_id)));
      } catch (err) {
        console.warn(`[3d] no PV surfaces for building ${osmId}`, err);
      }
    }, () => cancelled).then(() => { if (!cancelled) setByOsmId(new Map(found)); });
    return () => { cancelled = true; };
  }, [key, country]);

  return byOsmId;
}
