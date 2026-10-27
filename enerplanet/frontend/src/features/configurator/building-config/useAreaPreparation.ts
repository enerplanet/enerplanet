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

import { useTranslation } from '@spatialhub/i18n';

import axios from '@/lib/axios';
import { useModelStore } from '@/features/configurator/store/modelStore';

/** City2TABULA's run statuses, plus idle when no run is tracked. */
export type PreparationStatus = 'idle' | 'pending' | 'running' | 'completed' | 'no_data' | 'failed';

/** City2TABULA's pipeline step: import, extract_features or link_buildings, numbered 1 to 3. */
export interface PreparationStage {
  key: string;
  label: string;
  index: number;
  count: number;
}

interface PreparationState {
  status: PreparationStatus;
  /** osm_ids enrich reported as not yet linked when the run started. */
  missing: ReadonlySet<string>;
  /** Null while the run is pending, and before City2TABULA reported stages. */
  stage: PreparationStage | null;
}

const IDLE: PreparationState = { status: 'idle', missing: new Set(), stage: null };
const POLL_INTERVAL_MS = 3000;

export const useAreaPreparationStore = create<PreparationState>(() => IDLE);

export const isPreparing = (status: PreparationStatus): boolean => status === 'pending' || status === 'running';

export interface EnrichAnswer {
  status: string;
  run_id?: string;
  missing?: string[];
  stage?: string;
  stage_label?: string;
  stage_index?: number;
  stage_count?: number;
}

export const toStage = (answer: EnrichAnswer): PreparationStage | null =>
  answer.stage && answer.stage_index && answer.stage_count
    ? { key: answer.stage, label: answer.stage_label ?? answer.stage, index: answer.stage_index, count: answer.stage_count }
    : null;

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

    const settle = (status: PreparationStatus, missing?: string[], stage: PreparationStage | null = null) => {
      if (cancelled) return;
      useAreaPreparationStore.setState((s) => ({ status, missing: missing ? new Set(missing) : s.missing, stage }));
    };

    const poll = async (runId: string) => {
      try {
        const res = await axios.get<EnrichAnswer>(`/v1/city2tabula/enrich/${encodeURIComponent(runId)}`);
        const status = toStatus(res.data.status);
        settle(status, undefined, toStage(res.data));
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
        settle(status, res.data.missing ?? [], toStage(res.data));
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

/** "Step 2 of 3: Measuring roofs, walls and floors" while a run reports its stage, otherwise null. */
export function usePreparationStepText(): string | null {
  const { t } = useTranslation();
  const status = useAreaPreparationStore((s) => s.status);
  const stage = useAreaPreparationStore((s) => s.stage);
  if (status !== 'running' || !stage) return null;
  const label = t(`simulation.prepare3d.stages.${stage.key}`, stage.label);
  return t('simulation.prepare3d.step', { index: stage.index, count: stage.count, label });
}
