/**
 * Enriches every building of the loaded grid and polls the resulting
 * City2TABULA run (enrich answers 200 when all are linked, 202 with a run id
 * otherwise). useBuildingState reads the result for unlinked buildings.
 */

import { useEffect, useMemo } from 'react';
import { create } from 'zustand';
import bbox from '@turf/bbox';
import type { AllGeoJSON } from '@turf/helpers';
import { isAxiosError } from 'axios';

import axios from '@/lib/axios';
import { useModelStore } from '@/features/configurator/store/modelStore';

/** City2TABULA's run statuses, plus idle when no run is tracked. */
export type PreparationStatus = 'idle' | 'pending' | 'running' | 'completed' | 'no_data' | 'failed';

interface PreparationState {
  status: PreparationStatus;
  /** osm_ids enrich reported as not yet linked when the run started. */
  missing: ReadonlySet<string>;
}

const IDLE: PreparationState = { status: 'idle', missing: new Set() };
const POLL_INTERVAL_MS = 3000;

export const useAreaPreparationStore = create<PreparationState>(() => IDLE);

export const isPreparing = (status: PreparationStatus): boolean => status === 'pending' || status === 'running';

interface EnrichAnswer {
  status: string;
  run_id?: string;
  missing?: string[];
}

function toStatus(raw: string): PreparationStatus {
  if (raw === 'pending' || raw === 'running' || raw === 'completed' || raw === 'no_data') return raw;
  // "partial": buildings are missing and no run could be started.
  return 'failed';
}

/** Starts and follows the preparation run for the grid on screen. Mount once per page. */
export function useAreaPreparation(): void {
  const buildings = useModelStore((s) => s.pylovoGridData?.buildings);

  // Keyed on the building set and its extent, not the grid object, which is
  // rebuilt whenever the grid is reprocessed without any building changing.
  const area = useMemo(() => {
    const ids = (buildings?.features ?? []).map((f) => String(f.properties?.osm_id ?? '')).filter(Boolean);
    if (!buildings || ids.length === 0) return '';
    const [xmin, ymin, xmax, ymax] = bbox(buildings as AllGeoJSON, { recompute: true });
    if (!Number.isFinite(xmin)) return '';
    return JSON.stringify({ osmIds: Array.from(new Set(ids)).sort(), bbox: { xmin, ymin, xmax, ymax } });
  }, [buildings]);

  useEffect(() => {
    if (!area) {
      useAreaPreparationStore.setState(IDLE);
      return;
    }
    const { osmIds, bbox: box } = JSON.parse(area) as { osmIds: string[]; bbox: { xmin: number; ymin: number; xmax: number; ymax: number } };

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let restarted = false;

    const settle = (status: PreparationStatus, missing?: string[]) => {
      if (cancelled) return;
      useAreaPreparationStore.setState((s) => ({ status, missing: missing ? new Set(missing) : s.missing }));
    };

    const poll = async (runId: string) => {
      try {
        const res = await axios.get<EnrichAnswer>(`/v1/city2tabula/enrich/${encodeURIComponent(runId)}`);
        const status = toStatus(res.data.status);
        settle(status);
        if (isPreparing(status) && !cancelled) timer = setTimeout(() => poll(runId), POLL_INTERVAL_MS);
      } catch (err) {
        // City2TABULA keeps runs in memory, so a restart forgets the id; ask again once.
        if (isAxiosError(err) && err.response?.status === 404 && !restarted) {
          restarted = true;
          start();
          return;
        }
        console.warn(`[configurator] 3D preparation run ${runId} could not be polled`, err);
        settle('idle');
      }
    };

    const start = async () => {
      try {
        const res = await axios.post<EnrichAnswer>('/v1/city2tabula/enrich', {
          country: '',
          bbox: box,
          osm_ids: osmIds,
        });
        const status = toStatus(res.data.status);
        settle(status, res.data.missing ?? []);
        if (isPreparing(status) && res.data.run_id && !cancelled) timer = setTimeout(() => poll(res.data.run_id!), POLL_INTERVAL_MS);
      } catch (err) {
        console.warn('[configurator] 3D preparation could not be started', err);
        settle('idle', []);
      }
    };

    start();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [area]);
}
