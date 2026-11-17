import { useEffect, useRef } from 'react';
import type * as maplibregl from 'maplibre-gl';
import type { Map as OlMap } from 'ol';
import type { Feature, FeatureCollection, Geometry } from 'geojson';

import { addOrUpdatePolygon } from './maplibre-layers';

/** The area sketch as the 3D view's click and pointer handlers see it. */
export interface AreaSketch3D {
  /** Takes a click on the ground: true when it placed or closed a corner, so nothing else acts on it. */
  click: (pixel: [number, number], onModelFeature: boolean) => boolean;
  /** Moves the open edge to the pointer: true when drawing would take a click there. */
  move: (pixel: [number, number], onModelFeature: boolean) => boolean;
  /** True while corners have been placed and the area is not closed yet. */
  open: () => boolean;
}

type LngLat = [number, number];

const SOURCE = 'area-sketch-3d';
// The 2D drawer's snap distance to its first corner.
const CLOSE_PX = 20;
// A right press that moves further than this rotates the view (useMapLibreMap's drag threshold).
const RIGHT_CLICK_PX = 3;
// A press this close to a drawn area's corner drags the corner.
const CORNER_PX = 10;
const CYAN = '#06b6d4';
const CYAN_DARK = '#0e7490';

const feature = (role: string, geometry: Geometry): Feature => ({ type: 'Feature', properties: { role }, geometry });
const point = (role: string, at: LngLat) => feature(role, { type: 'Point', coordinates: at });

/** The sketch drawn on the ground: corners so far and the edge to the pointer. */
function sketchData(corners: LngLat[], cursor: LngLat | null, nearStart: boolean): FeatureCollection {
  const features: Feature[] = [];
  const path = cursor && !nearStart ? [...corners, cursor] : corners;
  if (path.length >= 3) features.push(feature('fill', { type: 'Polygon', coordinates: [[...path, path[0]]] }));
  if (path.length >= 2) features.push(feature('edge', { type: 'LineString', coordinates: nearStart ? [...path, path[0]] : path }));
  corners.forEach((c, i) => features.push(point(i === 0 ? (nearStart ? 'start-near' : 'start') : 'corner', c)));
  return { type: 'FeatureCollection', features };
}

function addSketchLayers(map: maplibregl.Map): void {
  map.addSource(SOURCE, { type: 'geojson', data: sketchData([], null, false) });
  const role = (...roles: string[]) => ['in', ['get', 'role'], ['literal', roles]] as maplibregl.FilterSpecification;
  map.addLayer({ id: `${SOURCE}-fill`, type: 'fill', source: SOURCE, filter: role('fill'), paint: { 'fill-color': '#000000', 'fill-opacity': 0.08 } });
  map.addLayer({ id: `${SOURCE}-edge`, type: 'line', source: SOURCE, filter: role('edge'), paint: { 'line-color': '#000000', 'line-width': 2, 'line-dasharray': [2, 2] } });
  map.addLayer({ id: `${SOURCE}-corner`, type: 'circle', source: SOURCE, filter: role('corner'), paint: { 'circle-radius': 4, 'circle-color': '#ffffff', 'circle-stroke-color': '#111827', 'circle-stroke-width': 1.5 } });
  map.addLayer({
    id: `${SOURCE}-start`, type: 'circle', source: SOURCE, filter: role('start', 'start-near'),
    paint: { 'circle-radius': ['case', ['==', ['get', 'role'], 'start-near'], 12, 8], 'circle-color': CYAN, 'circle-stroke-color': CYAN_DARK, 'circle-stroke-width': 2 },
  });
}

/**
 * Draws an area on the ground of the 3D view: each click places a corner where the pointer meets the
 * ground, a click on the first corner or a right-click closes the area, Escape abandons it. As in 2D, an area cannot
 * start on a building, which a click opens instead. onClose gets the corners as lon/lat. While no area is
 * being drawn, a corner of the drawn areas can be dragged; onCornerMoved gets it once it is let go.
 */
export function useAreaSketch3D(
  mapRef: React.RefObject<maplibregl.Map | null>,
  mapReady: boolean,
  olMap: OlMap,
  onClose: ((ring: LngLat[]) => void) | undefined,
  onOpenChange: ((open: boolean) => void) | undefined,
  cancelTrigger: number,
  areas: LngLat[][] | undefined,
  onCornerMoved: ((polygon: number, corner: number, to: LngLat) => void) | undefined,
): React.RefObject<AreaSketch3D | null> {
  const sketchRef = useRef<AreaSketch3D | null>(null);
  const onCloseRef = useRef(onClose);
  const onOpenChangeRef = useRef(onOpenChange);
  onCloseRef.current = onClose;
  onOpenChangeRef.current = onOpenChange;
  const areasRef = useRef(areas);
  areasRef.current = areas;
  const onCornerMovedRef = useRef(onCornerMoved);
  onCornerMovedRef.current = onCornerMoved;
  const enabled = !!onClose;

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !enabled) return;
    const addLayers = () => { if (!map.getSource(SOURCE)) addSketchLayers(map); };
    if (map.isStyleLoaded()) addLayers();
    else map.once('idle', addLayers);

    let corners: LngLat[] = [];
    let cursor: LngLat | null = null;
    let nearStart = false;
    const setData = (data: FeatureCollection) => (map.getSource(SOURCE) as maplibregl.GeoJSONSource | undefined)?.setData(data);
    const render = () => setData(sketchData(corners, cursor, nearStart));
    const ground = (pixel: [number, number]): LngLat => {
      const at = map.unproject(pixel);
      return [at.lng, at.lat];
    };
    const reset = () => {
      const wasOpen = corners.length > 0;
      corners = [];
      cursor = null;
      nearStart = false;
      render();
      if (wasOpen) onOpenChangeRef.current?.(false);
    };
    const isNearStart = (pixel: [number, number]) => {
      if (corners.length < 3) return false;
      const start = map.project(corners[0]);
      return Math.hypot(start.x - pixel[0], start.y - pixel[1]) < CLOSE_PX;
    };

    const close = () => {
      const ring = corners;
      reset();
      onCloseRef.current?.(ring);
    };

    sketchRef.current = {
      open: () => corners.length > 0,
      click: (pixel, onModelFeature) => {
        if (corners.length === 0 && onModelFeature) return false;
        if (isNearStart(pixel)) {
          close();
          return true;
        }
        corners = [...corners, ground(pixel)];
        if (corners.length === 1) onOpenChangeRef.current?.(true);
        render();
        return true;
      },
      move: (pixel, onModelFeature) => {
        if (corners.length === 0) return !onModelFeature;
        cursor = ground(pixel);
        nearStart = isNearStart(pixel);
        render();
        return true;
      },
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') reset(); };
    // The 2D map's viewport lies over the 3D one and takes the pointer.
    const viewport = olMap.getViewport();
    // A right-click closes the area, as on the 2D map. The viewport stops the press it hands
    // to MapLibre for rotating, so the window sees it in the capture phase.
    let rightDown: [number, number] | null = null;
    const onDown = (e: MouseEvent) => {
      // The copy of the press useMapLibreMap sends on to MapLibre's canvas is not the user's.
      if (!e.isTrusted) return;
      rightDown = e.button === 2 && viewport.contains(e.target as Node) ? [e.clientX, e.clientY] : null;
    };
    const onUp = (e: MouseEvent) => {
      if (e.button !== 2 || !rightDown) return;
      const moved = Math.hypot(e.clientX - rightDown[0], e.clientY - rightDown[1]);
      rightDown = null;
      if (moved <= RIGHT_CLICK_PX && corners.length >= 3) close();
    };
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('mouseup', onUp);

    let dragging: { polygon: number; corner: number; to?: LngLat } | null = null;
    const pixelOf = (e: PointerEvent): [number, number] => {
      const box = map.getContainer().getBoundingClientRect();
      return [e.clientX - box.left, e.clientY - box.top];
    };
    const cornerAt = (pixel: [number, number]) => {
      const rings = areasRef.current ?? [];
      for (let polygon = 0; polygon < rings.length; polygon++) {
        const corner = rings[polygon].findIndex((c) => {
          const at = map.project(c);
          return Math.hypot(at.x - pixel[0], at.y - pixel[1]) <= CORNER_PX;
        });
        if (corner >= 0) return { polygon, corner };
      }
      return null;
    };
    // Cancelling the press keeps it from the 2D map's click and from the pan that useMapLibreMap starts.
    const onCornerDown = (e: PointerEvent) => {
      if (!e.isTrusted || e.button !== 0 || corners.length > 0 || !viewport.contains(e.target as Node)) return;
      dragging = cornerAt(pixelOf(e));
      if (!dragging) return;
      e.preventDefault();
      e.stopPropagation();
    };
    const onCornerMove = (e: PointerEvent) => {
      if (!dragging) return;
      const { polygon, corner } = dragging;
      dragging.to = ground(pixelOf(e));
      const rings = (areasRef.current ?? []).map((ring) => [...ring]);
      rings[polygon][corner] = dragging.to;
      addOrUpdatePolygon(map, rings);
    };
    const onCornerUp = () => {
      const done = dragging;
      dragging = null;
      if (done?.to) onCornerMovedRef.current?.(done.polygon, done.corner, done.to);
    };
    window.addEventListener('pointerdown', onCornerDown, true);
    window.addEventListener('pointermove', onCornerMove);
    window.addEventListener('pointerup', onCornerUp);
    const onLeave = () => { if (cursor) { cursor = null; render(); } };
    // The whole 3D view closing removes the map before this effect is cleaned up.
    let removed = false;
    const onRemove = () => { removed = true; };
    map.on('remove', onRemove);
    document.addEventListener('keydown', onKey);
    viewport.addEventListener('pointerleave', onLeave);
    return () => {
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('pointerdown', onCornerDown, true);
      window.removeEventListener('pointermove', onCornerMove);
      window.removeEventListener('pointerup', onCornerUp);
      viewport.removeEventListener('pointerleave', onLeave);
      sketchRef.current = null;
      if (corners.length > 0) onOpenChangeRef.current?.(false);
      map.off('remove', onRemove);
      map.off('idle', addLayers);
      if (!removed) setData(sketchData([], null, false));
    };
  }, [mapRef, mapReady, olMap, enabled, cancelTrigger]);

  return sketchRef;
}
