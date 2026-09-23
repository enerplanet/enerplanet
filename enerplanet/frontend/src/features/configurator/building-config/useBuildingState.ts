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
  useConfiguratorApi,
  type BuildingState,
  type EnrichBbox,
} from '@thd-spatial-ai/building-configurator';

import { useModelStore } from '@/features/configurator/store/modelStore';

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
}

/**
 * Resolves one building by osm_id, or reports why it could not.
 *
 * The result keeps its identity until the osm_id changes: the configurator
 * resets all of its editing state whenever this object is a new one, so a
 * value rebuilt on every render would discard the user's edits as they made
 * them.
 */
export function useBuildingState(osmId: string | null): BuildingStateResult {
  const { enerplanet, ignis } = useConfiguratorApi();
  const pylovoGridData = useModelStore((s) => s.pylovoGridData);
  const [result, setResult] = useState<BuildingStateResult>({
    building: null,
    loading: false,
    error: null,
  });

  const feature = useMemo(() => {
    if (!osmId) return null;
    const features = (pylovoGridData?.buildings?.features ?? []) as unknown as BuildingFeature[];
    return features.find((f) => String(f.properties?.osm_id) === osmId) ?? null;
  }, [osmId, pylovoGridData]);

  // Guards a resolve that finishes after the user has moved to another
  // building, which would otherwise show them the wrong one.
  const currentOsmId = useRef<string | null>(null);

  useEffect(() => {
    currentOsmId.current = osmId;
    if (!osmId) {
      setResult({ building: null, loading: false, error: null });
      return;
    }
    if (!feature) {
      setResult({ building: null, loading: false, error: 'This building is not in the loaded grid.' });
      return;
    }
    const bbox = bboxOf(feature.geometry);
    if (!bbox) {
      setResult({ building: null, loading: false, error: 'This building has no usable footprint.' });
      return;
    }

    setResult({ building: null, loading: true, error: null });
    void (async () => {
      try {
        // The country is left out so the backend resolves it from the bbox
        // centre; this application holds a display name, not the canonical
        // form the backend matches on.
        const enrich = await enerplanet.enrichBuildings(bbox, [osmId]);
        if (currentOsmId.current !== osmId) return;
        if (!enrich.data?.[osmId]) {
          setResult({
            building: null,
            loading: false,
            error: 'No 3D envelope is available for this building yet.',
          });
          return;
        }
        const states = await buildBuildingStates(ignis, { features: [feature] }, enrich.data);
        if (currentOsmId.current !== osmId) return;
        setResult({ building: states[osmId] ?? null, loading: false, error: null });
      } catch (err) {
        if (currentOsmId.current !== osmId) return;
        console.error('[configurator] could not resolve building', osmId, err);
        setResult({ building: null, loading: false, error: 'This building could not be loaded.' });
      }
    })();
  }, [osmId, feature, enerplanet, ignis]);

  return result;
}
