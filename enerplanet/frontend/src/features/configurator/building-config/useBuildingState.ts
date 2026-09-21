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

/**
 * The country whose City2TABULA database holds this building, taken from the
 * advertised region its footprint falls in.
 *
 * The geometry endpoint needs the full country name because City2TABULA keeps a
 * database per country and derives it from this value; an ISO2 code resolves
 * nothing. availableRegions carries the name, so no second lookup is needed.
 */
function countryForBbox(
  bbox: EnrichBbox,
  regions: Array<{ country?: string; bbox?: { west: number; south: number; east: number; north: number } }>,
): string | null {
  const x = (bbox.xmin + bbox.xmax) / 2;
  const y = (bbox.ymin + bbox.ymax) / 2;
  const hit = regions.find(
    (r) =>
      r.country &&
      r.bbox &&
      x >= r.bbox.west &&
      x <= r.bbox.east &&
      y >= r.bbox.south &&
      y <= r.bbox.north,
  );
  return hit?.country ?? null;
}

export interface BuildingStateResult {
  building: BuildingState | null;
  loading: boolean;
  /** Set when the building resolved to nothing the configurator can show. */
  error: string | null;
  /**
   * The City2TABULA object_id the envelope came from. The surface geometry is
   * fetched by this rather than by osm_id, and it has to be the id this same
   * enrich answered with: the 3D view resolves a clicked surface to an envelope
   * element by id, so an object_id from a different call could name a building
   * whose surfaces no element matches.
   */
  objectId: string | null;
  /** Full country name for the geometry endpoint; see countryForBbox. */
  country: string | null;
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
  const availableRegions = useModelStore((s) => s.availableRegions);
  const [result, setResult] = useState<BuildingStateResult>({
    building: null,
    loading: false,
    error: null,
    objectId: null,
    country: null,
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
      setResult({ building: null, loading: false, error: null, objectId: null, country: null });
      return;
    }
    if (!feature) {
      setResult({ building: null, loading: false, error: 'This building is not in the loaded grid.', objectId: null, country: null });
      return;
    }
    const bbox = bboxOf(feature.geometry);
    if (!bbox) {
      setResult({ building: null, loading: false, error: 'This building has no usable footprint.', objectId: null, country: null });
      return;
    }

    setResult({ building: null, loading: true, error: null, objectId: null, country: null });
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
            objectId: null,
            country: null,
          });
          return;
        }
        const states = await buildBuildingStates(ignis, { features: [feature] }, enrich.data);
        if (currentOsmId.current !== osmId) return;
        setResult({
          building: states[osmId] ?? null,
          loading: false,
          error: null,
          objectId: enrich.data[osmId].object_id ?? null,
          country: countryForBbox(bbox, availableRegions),
        });
      } catch (err) {
        if (currentOsmId.current !== osmId) return;
        console.error('[configurator] could not resolve building', osmId, err);
        setResult({ building: null, loading: false, error: 'This building could not be loaded.', objectId: null, country: null });
      }
    })();
  }, [osmId, feature, enerplanet, ignis, availableRegions]);

  return result;
}
