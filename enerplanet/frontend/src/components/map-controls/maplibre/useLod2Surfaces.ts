import { useEffect, useMemo, useRef, useState } from 'react';

import axios from '@/lib/axios';
import { OBJECT_KEY_PREFIX } from '@/features/configurator/building-config/useBuildingState';

/** One LoD2 roof or wall polygon: rings of [lon, lat, height above sea level in m]. */
export interface Lod2Surface {
  /** City2TABULA's surface id, which stored PV arrays refer to. */
  id: string;
  roof: boolean;
  rings: number[][][];
}

/** One building of a /v1/city2tabula/surfaces page. */
export interface SurfacesBuilding {
  object_id: string;
  /** The building's OSM ways, best match first. */
  osm_ids: string[];
  surfaces: { id: string; type: string; geometry?: { type: string; coordinates: unknown } }[];
}

interface SurfacesPage {
  country: string;
  buildings: SurfacesBuilding[];
  next_cursor: string | null;
}

interface AreaSurfaces {
  country: string | null;
  surfaces: Map<string, Lod2Surface[]>;
}

// An area's LoD2 geometry does not change while the page is open, so it is
// fetched once per set of buildings and kept for later 3D views. The request
// itself is kept, so an area asked for twice at the same time is fetched once.
const areaCache = new Map<string, Promise<AreaSurfaces>>();
// The PV surface lookup runs one call per building; this many run at a time.
const PARALLEL_REQUESTS = 4;

/** Roof and wall polygons of one building; other surface types are left out. */
export function lod2SurfacesOf(building: SurfacesBuilding): Lod2Surface[] {
  const out: Lod2Surface[] = [];
  for (const surface of building.surfaces ?? []) {
    if (surface.type !== 'RoofSurface' && surface.type !== 'WallSurface') continue;
    const geometry = surface.geometry;
    let polygons: number[][][][] = [];
    if (geometry?.type === 'Polygon') polygons = [geometry.coordinates as number[][][]];
    else if (geometry?.type === 'MultiPolygon') polygons = geometry.coordinates as number[][][][];
    for (const rings of polygons) out.push({ id: surface.id, roof: surface.type === 'RoofSurface', rings });
  }
  return out;
}

/**
 * Adds each building's surfaces under the first of its keys in osmIds: its OSM
 * ways, then the `c2t:` key a custom-grid building carries. Every LoD2 building
 * under an outline is drawn, each once; one matching no key lies outside the
 * model and is skipped.
 */
export function addByOsmId(into: Map<string, Lod2Surface[]>, buildings: SurfacesBuilding[], osmIds: ReadonlySet<string>): void {
  for (const building of buildings) {
    const keys = [...(building.osm_ids ?? []), OBJECT_KEY_PREFIX + building.object_id];
    const osmId = keys.find((id) => osmIds.has(id));
    if (!osmId) continue;
    const surfaces = lod2SurfacesOf(building);
    if (surfaces.length > 0) into.set(osmId, [...(into.get(osmId) ?? []), ...surfaces]);
  }
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

/** Reads every page of the area's surfaces; the first page names the country the rest are read for. */
async function fetchArea(bbox: ReturnType<typeof bboxOf>, osmIds: ReadonlySet<string>): Promise<AreaSurfaces> {
  const surfaces = new Map<string, Lod2Surface[]>();
  let country: string | null = null;
  let cursor: string | null = null;
  do {
    const res: { data: SurfacesPage } = await axios.get<SurfacesPage>('/v1/city2tabula/surfaces', {
      params: { ...bbox, country: country ?? undefined, cursor: cursor ?? undefined },
    });
    country = res.data.country;
    addByOsmId(surfaces, res.data.buildings ?? [], osmIds);
    cursor = res.data.next_cursor;
  } while (cursor);
  return { country, surfaces };
}

function areaSurfaces(key: string, buildings: GeoJSON.FeatureCollection): Promise<AreaSurfaces> {
  let request = areaCache.get(key);
  if (!request) {
    request = fetchArea(bboxOf(buildings), new Set(key.split(',')));
    // A failed request is dropped, so the next 3D view asks again.
    request.catch(() => areaCache.delete(key));
    areaCache.set(key, request);
  }
  return request;
}

/**
 * The LoD2 roofs and walls City2TABULA has for the given WGS84 buildings, by
 * osm_id, loaded only while enabled, and the country they were read for. A
 * building without 3D data is absent, so the caller can keep drawing it
 * another way; loading is true until the area is read.
 */
export function useLod2Surfaces(buildings: GeoJSON.FeatureCollection | null, enabled: boolean): { surfaces: Map<string, Lod2Surface[]>; loading: boolean; country: string | null } {
  const [area, setArea] = useState<AreaSurfaces>(() => ({ country: null, surfaces: new Map() }));
  const [loading, setLoading] = useState(false);
  // The building data is rebuilt on many renders; the lookup restarts only when
  // the set of buildings changes, and reads their outlines from this ref.
  const buildingsRef = useRef(buildings);
  buildingsRef.current = buildings;
  const buildingKey = useMemo(() => (buildings ? osmIdsOf(buildings).sort().join(',') : ''), [buildings]);

  useEffect(() => {
    const current = buildingsRef.current;
    if (!enabled || !current?.features?.length || !buildingKey) return;
    let cancelled = false;
    setLoading(true);
    areaSurfaces(buildingKey, current)
      .then((result) => { if (!cancelled) setArea(result); })
      .catch((err) => console.warn('[3d] LoD2 surfaces unavailable; buildings stay flat footprints', err))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [buildingKey, enabled]);

  return { surfaces: area.surfaces, loading, country: area.country };
}
