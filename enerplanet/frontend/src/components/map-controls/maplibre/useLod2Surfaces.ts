import { useEffect, useMemo, useRef, useState } from 'react';

import axios from '@/lib/axios';

/** One LoD2 roof or wall polygon: rings of [lon, lat, height above sea level in m]. */
export interface Lod2Surface {
  /** City2TABULA's surface id, which stored PV arrays refer to. */
  id: string;
  roof: boolean;
  rings: number[][][];
}

interface GeometryResponse {
  buildings: { surfaces?: { id?: string; type: string; geojson?: { type: string; coordinates: unknown } }[] }[];
}

interface EnrichAnswer {
  country?: string;
  data?: Record<string, { object_id?: string }>;
}

// A building's LoD2 geometry does not change while the page is open, so it is
// fetched once per object_id and kept for later 3D views. The request itself is
// kept, so a building asked for twice at the same time is fetched once.
const surfaceCache = new Map<string, Promise<Lod2Surface[]>>();
// The geometry route serves one building per call; this many run at a time.
const PARALLEL_REQUESTS = 4;
// Surfaces found so far are drawn after this many buildings, not only at the end.
const PUBLISH_EVERY = 10;

/** Roof and wall polygons of a geometry response; ground and other surfaces are left out. */
export function lod2SurfacesOf(res: GeometryResponse): Lod2Surface[] {
  const out: Lod2Surface[] = [];
  for (const building of res.buildings ?? []) {
    for (const surface of building.surfaces ?? []) {
      if (surface.type !== 'RoofSurface' && surface.type !== 'WallSurface') continue;
      const geometry = surface.geojson;
      let polygons: number[][][][] = [];
      if (geometry?.type === 'Polygon') polygons = [geometry.coordinates as number[][][]];
      else if (geometry?.type === 'MultiPolygon') polygons = geometry.coordinates as number[][][][];
      for (const rings of polygons) out.push({ id: surface.id ?? '', roof: surface.type === 'RoofSurface', rings });
    }
  }
  return out;
}

function osmIdsOf(buildings: GeoJSON.FeatureCollection): string[] {
  const ids = new Set<string>();
  for (const f of buildings.features) {
    const id = f.properties?.osm_id;
    if (id !== undefined && id !== null && String(id).trim()) ids.add(String(id).trim());
  }
  return [...ids];
}

function bboxOf(buildings: GeoJSON.FeatureCollection) {
  const box = { xmin: Infinity, ymin: Infinity, xmax: -Infinity, ymax: -Infinity };
  const visit = (c: unknown): void => {
    if (!Array.isArray(c)) return;
    if (typeof c[0] === 'number') {
      box.xmin = Math.min(box.xmin, c[0]); box.xmax = Math.max(box.xmax, c[0]);
      box.ymin = Math.min(box.ymin, c[1] as number); box.ymax = Math.max(box.ymax, c[1] as number);
      return;
    }
    c.forEach(visit);
  };
  for (const f of buildings.features) visit((f.geometry as { coordinates?: unknown } | null)?.coordinates);
  return box;
}

/** Runs fn over items, PARALLEL_REQUESTS at a time, until all are done or cancelled() is true. */
export async function forEachLimited<T>(items: T[], fn: (item: T) => Promise<void>, cancelled: () => boolean): Promise<void> {
  const queue = [...items];
  const worker = async () => {
    while (!cancelled() && queue.length > 0) await fn(queue.shift()!);
  };
  await Promise.all(Array.from({ length: PARALLEL_REQUESTS }, worker));
}

function surfacesFor(country: string, objectId: string): Promise<Lod2Surface[]> {
  let request = surfaceCache.get(objectId);
  if (!request) {
    request = axios
      .get<GeometryResponse>('/v1/city2tabula/geometry', { params: { country, object_ids: objectId, srid: '4326' } })
      .then((res) => lod2SurfacesOf(res.data));
    // A failed request is dropped, so the next 3D view asks again.
    request.catch(() => surfaceCache.delete(objectId));
    surfaceCache.set(objectId, request);
  }
  return request;
}

/**
 * The LoD2 roofs and walls City2TABULA has for the given WGS84 buildings, by
 * osm_id, loaded only while enabled. A building without 3D data is absent, so
 * the caller can keep drawing it another way; loading is true until all are asked.
 */
export function useLod2Surfaces(buildings: GeoJSON.FeatureCollection | null, enabled: boolean): { surfaces: Map<string, Lod2Surface[]>; loading: boolean; country: string | null } {
  const [byOsmId, setByOsmId] = useState<Map<string, Lod2Surface[]>>(() => new Map());
  const [loading, setLoading] = useState(false);
  const [country, setCountry] = useState<string | null>(null);
  // The building data is rebuilt on many renders; the lookup restarts only when
  // the set of buildings changes, and reads their outlines from this ref.
  const buildingsRef = useRef(buildings);
  buildingsRef.current = buildings;
  const buildingKey = useMemo(() => (buildings ? osmIdsOf(buildings).sort().join(',') : ''), [buildings]);

  useEffect(() => {
    const current = buildingsRef.current;
    if (!enabled || !current?.features?.length || !buildingKey) return;
    let cancelled = false;
    const osmIds = buildingKey.split(',');
    setLoading(true);

    const load = async () => {
      const enrich = await axios.post<EnrichAnswer>('/v1/city2tabula/enrich', {
        country: '', bbox: bboxOf(current), osm_ids: osmIds,
      });
      const country = enrich.data.country;
      const entries = enrich.data.data ?? {};
      if (!country) return;
      if (!cancelled) setCountry(country);
      const queue = osmIds.flatMap((osmId) => {
        const objectId = entries[osmId]?.object_id;
        return objectId ? [{ osmId, objectId }] : [];
      });
      const found = new Map<string, Lod2Surface[]>();
      let done = 0;
      await forEachLimited(queue, async ({ osmId, objectId }) => {
        try {
          const surfaces = await surfacesFor(country, objectId);
          if (surfaces.length > 0) found.set(osmId, surfaces);
        } catch (err) {
          console.warn(`[3d] no LoD2 surfaces for building ${osmId} (object ${objectId})`, err);
        }
        done++;
        if (!cancelled && done % PUBLISH_EVERY === 0) setByOsmId(new Map(found));
      }, () => cancelled);
      if (!cancelled) setByOsmId(new Map(found));
    };

    load()
      .catch((err) => console.warn('[3d] LoD2 surfaces unavailable; buildings stay extruded', err))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [buildingKey, enabled]);

  return { surfaces: byOsmId, loading, country };
}
