/**
 * Resolves the BuildingState the configurator renders, for whichever building
 * the URL names.
 *
 * The footprint comes from the grid already on screen and the envelope from
 * City2TABULA, whose elements carry no U-values; those are resolved from the
 * building's TABULA archetype through ignis. Nothing is fetched until a
 * building is actually open.
 */

import { useEffect, useMemo, useRef, useState } from 'react';

import bbox from '@turf/bbox';
import type { AllGeoJSON } from '@turf/helpers';

import {
  buildBuildingStates,
  type BuildingState,
  type EnrichBbox,
  type EnrichResponse,
} from '@thd-spatial-ai/building-configurator';

import axios from '@/lib/axios';
import { useModelStore } from '@/features/configurator/store/modelStore';

import { creditsFor, type DatasetCredit } from './credits';
import { configuratorServices } from './heatClient';
import { fromStoredBuem, storedBuemOf } from './storedBuem';
import { isPreparing, useAreaPreparationStore, type PreparationStatus } from './useAreaPreparation';

interface BuildingFeature {
  type: 'Feature';
  geometry: unknown;
  properties: { osm_id: string; [key: string]: unknown };
}

/** The building's own extent, which is the area enrich is asked about. */
function bboxOf(geometry: unknown): EnrichBbox | null {
  // recompute ignores any bbox member already on the geometry, which may carry
  // a z range and so six numbers rather than four.
  const [xmin, ymin, xmax, ymax] = bbox(geometry as AllGeoJSON, { recompute: true });
  // turf answers [Infinity, Infinity, -Infinity, -Infinity] for a geometry with
  // no coordinates.
  if (!Number.isFinite(xmin)) return null;
  return { xmin, ymin, xmax, ymax };
}

export interface BuildingStateResult {
  building: BuildingState | null;
  loading: boolean;
  /** Set when the building resolved to nothing the configurator can show. */
  error: string | null;
  /** True while City2TABULA is still linking this building in the area's preparation run. */
  preparing: boolean;
  /**
   * The City2TABULA object_id the envelope came from. The surface geometry is
   * fetched by this, and it has to be the id this same enrich answered with:
   * the 3D view resolves a clicked surface to an envelope element by id.
   */
  objectId: string | null;
  /** The City2TABULA database the envelope came from, as the enrich resolved it. */
  country: string | null;
  /** Credits for the building's 3D dataset and, when it has one, its TABULA type. */
  credits: DatasetCredit[];
  /** True when the building opened from edits saved in the model rather than from City2TABULA. */
  edited: boolean;
}

const EMPTY: BuildingStateResult = { building: null, loading: false, error: null, preparing: false, objectId: null, country: null, credits: [], edited: false };

const failed = (error: string): BuildingStateResult => ({ ...EMPTY, error });

/** Enrich one building and build its state, or say why there is none. */
async function resolveBuilding(
  osmId: string,
  feature: BuildingFeature,
  box: EnrichBbox,
): Promise<BuildingStateResult> {
  // The country is left out so the backend resolves it from the bbox centre;
  // this application holds a display name, not the canonical form the backend
  // matches on.
  const res = await axios.post<EnrichResponse & { country?: string; attributions?: DatasetCredit[] }>('/v1/city2tabula/enrich', {
    country: '',
    bbox: box,
    osm_ids: [osmId],
  });
  const entry = res.data.data?.[osmId];
  // A building edited before reopens as it was saved; enrich still supplies
  // the object_id and country its 3D geometry is fetched by.
  const stored = storedBuemOf(feature.properties);
  if (!entry && !stored) return failed('No 3D envelope is available for this building yet.');

  const building = stored
    ? fromStoredBuem(osmId, feature.geometry, stored)
    : (await buildBuildingStates(configuratorServices, { features: [feature] }, res.data.data))[osmId];
  return {
    building: building ?? null,
    loading: false,
    error: null,
    preparing: false,
    objectId: entry?.object_id ?? null,
    country: res.data.country ?? null,
    credits: creditsFor(
      res.data.attributions,
      (entry as { dataset_id?: string } | undefined)?.dataset_id ?? null,
      Boolean(entry?.tabula_variant_code),
    ),
    edited: stored !== null,
  };
}

/**
 * Resolves one building by osm_id, or reports why it could not.
 *
 * The result keeps its identity until the osm_id changes: the configurator
 * resets all of its editing state whenever the building is a new object, so a
 * value rebuilt on every render would discard the user's edits as they made
 * them.
 */
export function useBuildingState(osmId: string | null): BuildingStateResult {
  const pylovoGridData = useModelStore((s) => s.pylovoGridData);
  const [result, setResult] = useState<BuildingStateResult>(EMPTY);

  const feature = useMemo(() => {
    if (!osmId) return null;
    const features = (pylovoGridData?.buildings?.features ?? []) as unknown as BuildingFeature[];
    return features.find((f) => String(f.properties?.osm_id) === osmId) ?? null;
  }, [osmId, pylovoGridData]);

  // Only a building the area's preparation run is still linking follows the run;
  // for every other building this stays 'ready', so the run finishing does not
  // re-resolve it and discard edits in progress.
  const runState = useAreaPreparationStore((s): PreparationStatus | 'ready' =>
    osmId !== null && s.missing.has(osmId) ? s.status : 'ready');

  // Guards a resolve that finishes after the user has moved to another
  // building, which would otherwise show them the wrong one.
  const currentOsmId = useRef<string | null>(null);

  useEffect(() => {
    currentOsmId.current = osmId;
    if (!osmId) return setResult(EMPTY);
    if (!feature) return setResult(failed('This building is not in the loaded grid.'));
    const box = bboxOf(feature.geometry);
    if (!box) return setResult(failed('This building has no usable footprint.'));
    if (runState !== 'ready' && isPreparing(runState)) return setResult({ ...EMPTY, preparing: true });
    if (runState === 'no_data') return setResult(failed('City2TABULA has no 3D data for this building.'));
    if (runState === 'failed') return setResult(failed('City2TABULA could not prepare the 3D data for this building.'));

    setResult({ ...EMPTY, loading: true });
    resolveBuilding(osmId, feature, box)
      .then((next) => {
        if (currentOsmId.current === osmId) setResult(next);
      })
      .catch((err) => {
        if (currentOsmId.current !== osmId) return;
        console.error('[configurator] could not resolve building', osmId, err);
        setResult(failed('This building could not be loaded.'));
      });
  }, [osmId, feature, runState]);

  return result;
}
