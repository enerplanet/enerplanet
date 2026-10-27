/**
 * The BuEM results stored for a saved model, one annual summary per building,
 * as GET /models/{id}/demand-profiles serves them. The map tooltip reads them so
 * it shows the same totals as the configurator's energy overview.
 */

import { useEffect, useState } from 'react';

import axios from '@/lib/axios';

/** One building's stored outcome (backend contracts.BuildingDemandProfile). */
export interface StoredDemandProfile {
  osm_id: string;
  /** resolved, pending, failed or shared. */
  status: string;
  building_type?: string;
  tabula_variant_code?: string;
  heating_kwh_a?: number;
  cooling_kwh_a?: number;
  electricity_kwh_a?: number;
  hot_water_kwh_a?: number;
  /** kWh of gas, a separate carrier: never part of the total. */
  kitchen_kwh_a?: number;
  /** Why it failed, or for a shared building the one it is counted under. */
  error_message?: string;
  /** Storeys BuEM modelled, from the 3D geometry. */
  n_storeys?: number;
  /** Conditioned floor area BuEM modelled, m². */
  a_ref_m2?: number;
  /** Room height BuEM modelled, m. */
  h_room_m?: number;
}

interface ModelDemandProfiles {
  /** idle, resolving or completed. */
  status: string;
  total: number;
  resolved: number;
  pending: number;
  failed: number;
  shared: number;
  buildings: StoredDemandProfile[];
}

/** How far the analysis of a model's buildings has got. */
export interface AnalysisProgress {
  /** idle (never analysed), resolving or completed. */
  status: string;
  total: number;
  /** Buildings with an outcome: resolved, failed or shared. */
  done: number;
  failed: number;
}

/** Annual totals of a resolved building, in kWh. */
export interface BuemTotals {
  total: number;
  heating: number;
  electricity: number;
  cooling: number;
  hotWater: number;
  kitchenGas: number;
}

/**
 * The totals the configurator's energy overview shows: heating, electricity,
 * cooling and hot water add up to the total; kitchen gas stays apart.
 */
export function buemTotals(profile: StoredDemandProfile): BuemTotals | null {
  if (profile.status !== 'resolved') return null;
  const heating = profile.heating_kwh_a ?? 0;
  const electricity = profile.electricity_kwh_a ?? 0;
  const cooling = profile.cooling_kwh_a ?? 0;
  const hotWater = profile.hot_water_kwh_a ?? 0;
  return {
    total: heating + electricity + cooling + hotWater,
    heating,
    electricity,
    cooling,
    hotWater,
    kitchenGas: profile.kitchen_kwh_a ?? 0,
  };
}

/** How often the profiles are read again while the model's analysis is in progress. */
const RESOLVING_POLL_MS = 3_000;

/**
 * The stored profiles of modelId keyed by osm_id, and the analysis progress;
 * empty and null for a model not saved yet. They are read again whenever
 * refreshKey changes and every RESOLVING_POLL_MS while an analysis runs.
 */
export function useModelDemandProfiles(
  modelId: number | undefined,
  refreshKey: string,
): { profiles: Map<string, StoredDemandProfile>; progress: AnalysisProgress | null } {
  const [profiles, setProfiles] = useState<Map<string, StoredDemandProfile>>(new Map());
  const [progress, setProgress] = useState<AnalysisProgress | null>(null);

  useEffect(() => {
    if (!modelId) {
      setProfiles(new Map());
      setProgress(null);
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const res = await axios.get<ModelDemandProfiles>(`/models/${modelId}/demand-profiles`);
        if (cancelled) return;
        const d = res.data;
        setProfiles(new Map(d.buildings.map((b) => [b.osm_id, b])));
        setProgress({ status: d.status, total: d.total, done: d.resolved + d.failed + d.shared, failed: d.failed });
        if (d.status === 'resolving') timer = setTimeout(load, RESOLVING_POLL_MS);
      } catch (err) {
        if (!cancelled) console.error('[map] could not load the stored demand profiles of model', modelId, err);
      }
    };
    void load();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [modelId, refreshKey]);

  return { profiles, progress };
}
