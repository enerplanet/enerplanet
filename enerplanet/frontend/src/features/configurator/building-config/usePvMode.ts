/**
 * PV mode for one building: the roofs and walls offered for PV, which of them
 * carry an array, and the callbacks the 3D view calls when the user changes one.
 * The arrays are EnerPlanET's; the view only renders them.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type PvMode,
  type PvMounting,
  type PvOrientation,
  type PvSurface,
  type SurfacePolygon,
  type TechnologyProduct,
} from '@thd-spatial-ai/building-configurator';

import axios from '@/lib/axios';

import { arrayWithLayout, bestFitArrays } from './pvBestFit';
import {
  copyOfProduct, moduleOf, productCopies, withProductValue, withValues, type PvProductCopy, type PvValues,
} from './pvProducts';

/**
 * One PV array on a surface, as stored in techs.pv_supply.arrays. tilt and
 * azimuth are the panels' own angles; with a module layout, modules and
 * capacity_kw come from it.
 */
export interface PvArray {
  surface_id: string;
  tilt: number;
  azimuth: number;
  area: number;
  usable_share: number;
  /** Absent: the configurator's default, racked under 10° tilt, otherwise flush. */
  mounting?: PvMounting;
  /** Absent: best fit. */
  orientation?: PvOrientation;
  modules?: number;
  capacity_kw?: number;
  /** The product on this surface, a key of BuildingPv.products. Absent: the building's product. */
  product_id?: string;
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
  /** The catalogue product the building's PV was added with. */
  productId?: string;
  /** The building's own PV parameters. */
  constraints?: PvProductCopy['constraints'];
  /** The building's copy of each product its arrays name, by product id. */
  products?: Record<string, PvProductCopy>;
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
 * onArrays receives every change as the building's full list of arrays, each
 * laid out with its product's module on its surface's polygon where the view's
 * geometry has one, the copies of the products they name, and the building's
 * own PV values.
 */
export function usePvMode(
  osmId: string,
  country: string | null,
  building: BuildingPv | null,
  notice: string,
  onArrays: (arrays: PvArray[], products: Record<string, PvProductCopy>, constraints: PvValues['constraints']) => void,
  shownObjectId: string | null,
  t: (key: string, options?: Record<string, unknown>) => string,
  polygons: readonly SurfacePolygon[] | null,
  onRemove?: () => void,
  catalogue?: TechnologyProduct[],
): { pv: PvMode | undefined; failed: boolean } {
  const stored = building?.arrays ?? null;
  const [arrays, setArrays] = useState<PvArray[] | null>(stored);
  // PV added or removed while the view is open replaces the arrays held here.
  const [seen, setSeen] = useState(stored);
  if (stored !== seen) {
    setSeen(stored);
    setArrays(stored);
  }
  const active = building !== null;
  const { rows, failed } = usePvSurfaceRows(osmId, country, active);

  const productId = building?.productId;
  const storedConstraints = building?.constraints;
  const storedCopies = building?.products;
  const [values, setValues] = useState<PvValues>({ constraints: storedConstraints, copies: storedCopies });
  const [seenValues, setSeenValues] = useState({ storedConstraints, storedCopies });
  if (storedConstraints !== seenValues.storedConstraints || storedCopies !== seenValues.storedCopies) {
    setSeenValues({ storedConstraints, storedCopies });
    setValues({ constraints: storedConstraints, copies: storedCopies });
  }
  const buildingModule = useMemo(() => moduleOf(values.constraints), [values.constraints]);
  const moduleFor = useCallback((id: string | undefined) => {
    if (!id) return buildingModule;
    const product = catalogue?.find((p) => p.id === id);
    return moduleOf((values.copies?.[id] ?? (product && copyOfProduct(product)))?.constraints);
  }, [buildingModule, values.copies, catalogue]);

  // A building still on automatic placement shows the best fit; the first change stores it.
  const installed = useMemo(
    () => arrays ?? bestFitArrays(rows ?? [], polygons ?? [], DEFAULT_USABLE_SHARE, buildingModule),
    [arrays, rows, polygons, buildingModule],
  );
  const polygonById = useMemo(() => new Map((polygons ?? []).map((p) => [p.id, p])), [polygons]);
  const laidOut = useCallback(
    (array: PvArray) => arrayWithLayout(array, polygonById.get(array.surface_id), moduleFor(array.product_id)),
    [polygonById, moduleFor],
  );

  // The view can call two callbacks in one event (assign, then toggle); the second must see the first's result.
  const latest = useRef(installed);
  latest.current = installed;
  // Hosts pass new callbacks on every render; a new pv object would make the view lay out every surface again.
  const host = useRef({ onArrays, onRemove, values, catalogue, productId });
  host.current = { onArrays, onRemove, values, catalogue, productId };

  const store = useCallback((next: PvArray[], nextValues: PvValues) => {
    host.current.onArrays(next, productCopies(next, nextValues.copies, host.current.catalogue), nextValues.constraints);
  }, []);
  const change = useCallback((next: PvArray[]) => {
    latest.current = next;
    setArrays(next);
    store(next, host.current.values);
  }, [store]);

  const onConstraintChange = useCallback((id: string, key: string, value: number | string) => {
    const { values: current, catalogue: products, productId: own } = host.current;
    const next = withProductValue(current, id, key, value, own, products);
    host.current.values = next;
    setValues(next);
    store(latest.current, next);
  }, [store]);
  const shownProducts = useMemo(() => {
    const out: Record<string, TechnologyProduct> = {};
    for (const product of catalogue ?? []) {
      const own = product.id === productId ? values.constraints : values.copies?.[product.id]?.constraints;
      if (own) out[product.id] = withValues(product, own);
    }
    return out;
  }, [catalogue, productId, values]);
  const hasRemove = onRemove !== undefined;
  const remove = useMemo(() => (hasRemove ? () => host.current.onRemove?.() : undefined), [hasRemove]);

  const onToggle = useCallback((surfaceId: string, on: boolean) => {
    const row = rows?.find((r) => r.surface_id === surfaceId);
    if (!row) return;
    const current = latest.current;
    const existing = current.find((a) => a.surface_id === surfaceId);
    const others = current.filter((a) => a.surface_id !== surfaceId);
    change(on ? [...others, existing ?? laidOut(toArray(row))] : others);
  }, [rows, change, laidOut]);

  const onAssignProduct = useCallback((surfaceId: string, id: string) => {
    const row = rows?.find((r) => r.surface_id === surfaceId);
    if (!row) return;
    const current = latest.current;
    const array = current.find((a) => a.surface_id === surfaceId) ?? toArray(row);
    const others = current.filter((a) => a.surface_id !== surfaceId);
    change([...others, laidOut({ ...array, product_id: id })]);
  }, [rows, change, laidOut]);

  const onShareChange = useCallback((surfaceId: string, usableShare: number) => {
    change(installed.map((a) => (a.surface_id === surfaceId ? laidOut({ ...a, usable_share: usableShare }) : a)));
  }, [installed, change, laidOut]);

  const onMountingChange = useCallback((surfaceId: string, mounting: PvMounting, orientation: PvOrientation | undefined) => {
    change(installed.map((a) => (a.surface_id === surfaceId ? laidOut({ ...a, mounting, orientation }) : a)));
  }, [installed, change, laidOut]);

  const typeLabel = t("technologies.types.pv_supply", { defaultValue: building?.typeLabel ?? "" });
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
        mounting: array?.mounting,
        orientation: array?.orientation,
        label: labels[row.surface_id],
        tilt: row.tilt,
        azimuth: row.azimuth,
        area: row.area,
        productId: array?.product_id,
      };
    }
    const products = catalogue ? { catalogue, productId, onAssignProduct, products: shownProducts, onConstraintChange } : {};
    return {
      surfaces, notice, typeLabel, onToggle, onShareChange, onMountingChange, module: buildingModule, onRemove: remove, ...products,
    };
  }, [
    active, rows, installed, notice, typeLabel, onToggle, onShareChange, onMountingChange, shownObjectId, t,
    buildingModule, remove, catalogue, productId, onAssignProduct, shownProducts, onConstraintChange,
  ]);

  return { pv, failed };
}
