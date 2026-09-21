/**
 * Resolves the envelope surface geometry the 3D view renders, for one building.
 *
 * Separate from useBuildingState because the two answer different questions and
 * fail independently: a building can have an envelope and thermal properties
 * with no renderable geometry behind it, and the view is built to show the
 * former while the latter is still arriving.
 */

import { useEffect, useRef, useState } from 'react';

import { surfacesFromGeometryResponse, type SurfaceGeometry } from '@thd-spatial-ai/building-configurator/experimental';

import { heatClient } from './heatClient';

export interface BuildingGeometryResult {
  /** Null while loading, which is what Building3DView expects. */
  geometry: SurfaceGeometry | null;
  error: string | null;
}

/**
 * Fetches one building's surfaces by City2TABULA object_id.
 *
 * country is the full name, not an ISO2 code: City2TABULA keeps a database per
 * country and derives it from this value, so "DE" resolves nothing.
 */
export function useBuildingGeometry(
  objectId: string | null,
  country: string | null,
): BuildingGeometryResult {
  const [result, setResult] = useState<BuildingGeometryResult>({ geometry: null, error: null });

  // Guards a response that arrives after the user has moved to another
  // building, which would otherwise render the wrong model.
  const current = useRef<string | null>(null);

  useEffect(() => {
    current.current = objectId;
    setResult({ geometry: null, error: null });
    if (!objectId || !country) return;

    void (async () => {
      try {
        const params = new URLSearchParams({ country, object_ids: objectId });
        const buildings = await heatClient.get(`/v1/city2tabula/geometry?${params}`);
        if (current.current !== objectId) return;
        const surfaces = surfacesFromGeometryResponse(
          Array.isArray(buildings) ? buildings : [],
        );
        if (surfaces.length === 0) {
          setResult({ geometry: null, error: 'This building has no surface geometry to draw.' });
          return;
        }
        setResult({ geometry: { surfaces }, error: null });
      } catch (err) {
        if (current.current !== objectId) return;
        console.error('[configurator] could not load geometry for', objectId, err);
        setResult({ geometry: null, error: 'This building’s geometry could not be loaded.' });
      }
    })();
  }, [objectId, country]);

  return result;
}
