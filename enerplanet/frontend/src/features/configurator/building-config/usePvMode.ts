/**
 * PV mode for one building: the roofs and walls offered for PV, which of them
 * carry an array, and the callbacks the 3D view calls when the user changes one.
 * The arrays are EnerPlanET's; the view only renders them.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { PvMode, PvSurface } from '@thd-spatial-ai/building-configurator';

import axios from '@/lib/axios';

/** One PV array on a surface, as stored in techs.pv_supply.arrays. */
export interface PvArray {
  surface_id: string;
  tilt: number;
  azimuth: number;
  area: number;
  usable_share: number;
}

export interface PvSurfaceRow extends PvArray {
  kind: 'roof' | 'wall';
  qualifies: boolean;
  suggested: boolean;
  /** The 3D building of the surface; an OSM way can cover several. */
  object_id?: string;
}

/**
 * Labels for surfaces of the way's other 3D buildings, which the view does not
 * show: "Roof on another 3D building (2 of 3)". The shown building counts as 1.
 */
export function otherBuildingLabels(
  rows: readonly PvSurfaceRow[],
  shownObjectId: string | null,
  t: (key: string, options?: Record<string, unknown>) => string,
): Record<string, string> {
  const others: string[] = [];
  for (const row of rows) {
    if (row.object_id && row.object_id !== shownObjectId && !others.includes(row.object_id)) others.push(row.object_id);
  }
  const labels: Record<string, string> = {};
  for (const row of rows) {
    if (!row.object_id || row.object_id === shownObjectId) continue;
    const key = row.kind === 'wall' ? 'buildingConfig.pv.otherWall' : 'buildingConfig.pv.otherRoof';
    labels[row.surface_id] = t(key, { n: others.indexOf(row.object_id) + 2, total: others.length + 1 });
  }
  return labels;
}

/** The building's PV technology as the host stores it. */
export interface BuildingPv {
  typeLabel: string;
  /** null while placement is automatic, which uses the qualifying roofs. */
  arrays: PvArray[] | null;
}

// Matches the backend's pv.KWPerSqm.
export const KWP_PER_M2 = 0.2;
// Matches the backend's pv.DefaultUsableShare.
export const DEFAULT_USABLE_SHARE = 0.8;

const toArray = ({ surface_id, tilt, azimuth, area, usable_share }: PvArray): PvArray =>
  ({ surface_id, tilt, azimuth, area, usable_share });

/** The arrays PV covers: the stored ones, or the qualifying roofs while placement is automatic. */
export function installedPvArrays(arrays: PvArray[] | null, rows: PvSurfaceRow[] | null): PvArray[] {
  return arrays ?? rows?.filter((r) => r.qualifies).map(toArray) ?? [];
}

/**
 * The building's roofs and walls offered for PV, loaded while active; null
 * until loaded, and failed when loading them failed.
 */
export function usePvSurfaceRows(osmId: string, country: string | null, active: boolean) {
  const [rows, setRows] = useState<PvSurfaceRow[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!active || !country) return;
    let cancelled = false;
    axios
      .get<{ surfaces: PvSurfaceRow[] }>('/v1/city2tabula/pv-surfaces', { params: { osm_id: osmId, country } })
      .then((res) => { if (!cancelled) setRows(res.data.surfaces); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [active, osmId, country]);

  return { rows, failed };
}

function stateOf(row: PvSurfaceRow, installed: boolean): PvSurface['state'] {
  if (installed) return 'installed';
  return row.suggested ? 'suggested' : 'available';
}

/**
 * Returns the PV mode to pass to Building3DView once the surfaces are loaded,
 * and whether loading them failed; nothing is loaded while building is null.
 * onArrays receives every change as the building's full list of arrays.
 */
export function usePvMode(
  osmId: string,
  country: string | null,
  building: BuildingPv | null,
  notice: string,
  onArrays: (arrays: PvArray[]) => void,
  shownObjectId: string | null,
  t: (key: string, options?: Record<string, unknown>) => string,
): { pv: PvMode | undefined; failed: boolean } {
  const [arrays, setArrays] = useState<PvArray[] | null>(building?.arrays ?? null);
  const active = building !== null;
  const { rows, failed } = usePvSurfaceRows(osmId, country, active);

  const installed = useMemo(() => installedPvArrays(arrays, rows), [arrays, rows]);

  const change = useCallback((next: PvArray[]) => {
    setArrays(next);
    onArrays(next);
  }, [onArrays]);

  const onToggle = useCallback((surfaceId: string, on: boolean) => {
    const row = rows?.find((r) => r.surface_id === surfaceId);
    if (!row) return;
    const others = installed.filter((a) => a.surface_id !== surfaceId);
    change(on ? [...others, toArray(row)] : others);
  }, [rows, installed, change]);

  const onShareChange = useCallback((surfaceId: string, usableShare: number) => {
    change(installed.map((a) => (a.surface_id === surfaceId ? { ...a, usable_share: usableShare } : a)));
  }, [installed, change]);

  const typeLabel = building?.typeLabel ?? "";
  const pv = useMemo<PvMode | undefined>(() => {
    if (!active || !rows) return undefined;
    const labels = otherBuildingLabels(rows, shownObjectId, t);
    const surfaces: Record<string, PvSurface> = {};
    for (const row of rows) {
      const array = installed.find((a) => a.surface_id === row.surface_id);
      const usableShare = array?.usable_share ?? row.usable_share;
      surfaces[row.surface_id] = {
        state: stateOf(row, array !== undefined),
        usableShare,
        maxKwp: Number((row.area * usableShare * KWP_PER_M2).toFixed(1)),
        label: labels[row.surface_id],
      };
    }
    return { surfaces, notice, typeLabel, onToggle, onShareChange };
  }, [active, rows, installed, notice, typeLabel, onToggle, onShareChange, shownObjectId, t]);

  return { pv, failed };
}
