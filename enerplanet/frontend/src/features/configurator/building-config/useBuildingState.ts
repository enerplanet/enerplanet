/**
 * Resolves the BuildingState the configurator panel renders, for whichever
 * building the URL names.
 *
 * The footprint comes from the grid already on screen, the envelope from
 * City2TABULA and its U-values from the TABULA archetype. Nothing is fetched
 * until a building is actually open.
 */

import { useEffect, useMemo, useRef, useState } from 'react';

import { useModelStore } from '@/features/configurator/store/modelStore';

import type { BuildingState } from './panel/lib/buemAdapter';
import { buildBuildingState } from './panel/lib/city2tabulaAdapter';
import { fetchEnvelopes, type EnrichBbox } from './panel/lib/heatService';

interface BuildingFeature {
  type: 'Feature';
  geometry: unknown;
  properties: { osm_id: string; [key: string]: unknown };
}

/** Every [lon, lat] pair in a Polygon/MultiPolygon, however deeply nested. */
function vertices(geometry: unknown): [number, number][] {
  const out: [number, number][] = [];
  const walk = (node: unknown) => {
    if (!Array.isArray(node)) return;
    if (typeof node[0] === 'number' && typeof node[1] === 'number') {
      out.push([node[0], node[1]]);
      return;
    }
    node.forEach(walk);
  };
  walk((geometry as { coordinates?: unknown } | undefined)?.coordinates);
  return out;
}

/** The building's own extent, which is the area enrich is asked about. */
function bboxOf(geometry: unknown): EnrichBbox | null {
  const points = vertices(geometry);
  if (points.length === 0) return null;
  const lons = points.map((p) => p[0]);
  const lats = points.map((p) => p[1]);
  return {
    xmin: Math.min(...lons),
    ymin: Math.min(...lats),
    xmax: Math.max(...lons),
    ymax: Math.max(...lats),
  };
}

export interface BuildingStateResult {
  building: BuildingState | null;
  loading: boolean;
  /** Set when the building resolved to nothing the panel can show. */
  error: string | null;
}

/**
 * Resolves one building by osm_id, or reports why it could not.
 *
 * The result keeps its identity until the osm_id changes: the panel resets all
 * of its editing state whenever this object is a new one, so a value rebuilt on
 * every render would discard the user's edits as they made them.
 */
export function useBuildingState(osmId: string | null): BuildingStateResult {
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
      const envelopes = await fetchEnvelopes(bbox, [osmId]);
      const entry = envelopes[osmId];
      if (currentOsmId.current !== osmId) return;
      if (!entry) {
        setResult({
          building: null,
          loading: false,
          error: 'No 3D envelope is available for this building yet.',
        });
        return;
      }
      const building = await buildBuildingState(feature, entry);
      if (currentOsmId.current !== osmId) return;
      setResult({ building, loading: false, error: null });
    })();
  }, [osmId, feature]);

  return result;
}
