/**
 * Resolves the envelope surface geometry the 3D view renders, for one building.
 *
 * Separate from useBuildingState because the two fail independently: a
 * building can have an envelope and thermal properties with no renderable
 * geometry behind it.
 */

import { useEffect, useRef, useState } from 'react';

import {
  surfacesFromGeometryResponse,
  type BuildingGeometry,
  type SurfaceGeometry,
} from '@thd-spatial-ai/building-configurator';

import axios from '@/lib/axios';

import type { DatasetCredit } from './credits';

export interface BuildingGeometryResult {
  /** Null while loading, which is what Building3DView expects. */
  geometry: SurfaceGeometry | null;
  error: string | null;
}

/**
 * Fetches one building's surfaces by City2TABULA object_id.
 *
 * country is the full name, not an ISO2 code: City2TABULA keeps a database per
 * country and derives it from this value, so "DE" resolves nothing. Only one
 * building is asked for, because a face count is unbounded and several exceed
 * the response size the request path accepts.
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
    if (!objectId) return;
    if (!country) {
      setResult({ geometry: null, error: 'The country of this building is not known, so its 3D model cannot be fetched.' });
      return;
    }

    axios
      .get<{ buildings: BuildingGeometry[]; attributions: DatasetCredit[] }>('/v1/city2tabula/geometry', {
        params: { country, object_ids: objectId },
      })
      .then((res) => {
        if (current.current !== objectId) return;
        const surfaces = surfacesFromGeometryResponse(res.data?.buildings ?? []);
        setResult(surfaces.length > 0
          ? { geometry: { surfaces }, error: null }
          : { geometry: null, error: 'This building has no surface geometry to draw.' });
      })
      .catch((err) => {
        if (current.current !== objectId) return;
        console.error('[configurator] could not fetch geometry', objectId, err);
        setResult({ geometry: null, error: 'The 3D model of this building could not be loaded.' });
      });
  }, [objectId, country]);

  return result;
}
