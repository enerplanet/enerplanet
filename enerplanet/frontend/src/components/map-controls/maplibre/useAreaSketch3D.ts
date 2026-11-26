import { useEffect, useRef } from 'react';
import type * as maplibregl from 'maplibre-gl';
import type { Map as OlMap } from 'ol';
import type { Feature, FeatureCollection, Geometry } from 'geojson';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';

import type { PointerTarget } from '@/features/polygon-drawer/PolygonDrawer';

import { addOrUpdatePolygon } from './maplibre-layers';

/** The area sketch as the 3D view's click and pointer handlers see it. */
export interface AreaSketch3D {
  /** Takes a click on the ground: true when it placed or closed a corner, so nothing else acts on it. */
  click: (pixel: [number, number], onModelFeature: boolean) => boolean;
  /**
   * Moves the open edge to the pointer, or marks the corner or edge point of a drawn area a press there
   * would edit. Gives the cursor for the pointer: "move" over an edit point, "crosshair" where a click
   * would draw, null where drawing takes no click.
   */
  move: (pixel: [number, number], onModelFeature: boolean) => 'move' | 'crosshair' | null;
  /** True while corners have been placed and the area is not closed yet. */
  open: () => boolean;
}

type LngLat = [number, number];
type Pixel = [number, number];

const SOURCE = 'area-sketch-3d';
// The 2D drawer's snap distance to its first corner.
const CLOSE_PX = 20;
// A right press that moves further than this rotates the view (useMapLibreMap's drag threshold).
const RIGHT_CLICK_PX = 3;
// A press this close to a drawn area's corner or edge edits it, as Modify's pixelTolerance does in 2D.
const EDIT_PX = 10;
const CYAN = '#06b6d4';
const CYAN_DARK = '#0e7490';
// The 2D drawer's edit point stroke.
const CYAN_EDGE = '#0891b2';

const feature = (role: string, geometry: Geometry): Feature => ({ type: 'Feature', properties: { role }, geometry });
const point = (role: string, at: LngLat) => feature(role, { type: 'Point', coordinates: at });

/** The sketch drawn on the ground: corners so far, the edge to the pointer, and the edit point under it. */
function sketchData(corners: LngLat[], cursor: LngLat | null, nearStart: boolean, handle: LngLat | null = null): FeatureCollection {
  const features: Feature[] = [];
  if (handle) features.push(point('handle', handle));
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
  map.addLayer({
    id: `${SOURCE}-handle`, type: 'circle', source: SOURCE, filter: role('handle'),
    paint: { 'circle-radius': 6, 'circle-color': CYAN, 'circle-stroke-color': CYAN_EDGE, 'circle-stroke-width': 2 },
  });
}

/** A point of a drawn area a press would edit: corner `corner`, or a point on the edge that starts at it. */
export interface EditHandle {
  polygon: number;
  corner: number;
  onEdge: boolean;
  at: Pixel;
}

function closestOnSegment(a: Pixel, b: Pixel, p: Pixel): Pixel {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lengthSquared));
  return [a[0] + t * dx, a[1] + t * dy];
}

/**
 * The corner of the rings (lon/lat, first not repeated) within tolerance pixels of pixel, else the
 * nearest point on an edge within it. Corners win over edges, as in the 2D drawer.
 */
export function editHandleAt(rings: LngLat[][], pixel: Pixel, project: (c: LngLat) => Pixel, tolerance: number): EditHandle | null {
  const projected = rings.map((ring) => ring.map(project));
  const distance = (a: Pixel) => Math.hypot(a[0] - pixel[0], a[1] - pixel[1]);
  for (let polygon = 0; polygon < projected.length; polygon++) {
    const corner = projected[polygon].findIndex((c) => distance(c) <= tolerance);
    if (corner >= 0) return { polygon, corner, onEdge: false, at: projected[polygon][corner] };
  }
  let nearest: EditHandle | null = null;
  for (let polygon = 0; polygon < projected.length; polygon++) {
    const ring = projected[polygon];
    for (let corner = 0; corner < ring.length; corner++) {
      const at = closestOnSegment(ring[corner], ring[(corner + 1) % ring.length], pixel);
      if (distance(at) <= tolerance && (!nearest || distance(at) < distance(nearest.at))) nearest = { polygon, corner, onEdge: true, at };
    }
  }
  return nearest;
}

/** Index of the area (lon/lat rings, first corner not repeated) that contains point, or -1. */
export function areaAt(rings: LngLat[][], point: LngLat): number {
  return rings.findIndex((ring) => ring.length >= 3 && booleanPointInPolygon(point, { type: 'Polygon', coordinates: [[...ring, ring[0]]] }));
}

/** What the 3D sketch reports, as the 2D drawer's callbacks of the same purpose do. */
export interface AreaSketch3DCallbacks {
  /** Gets the corners of a closed area as lon/lat; without it the sketch is off. */
  onClose?: (ring: LngLat[]) => void;
  onOpenChange?: (open: boolean) => void;
  /** Gets a polygon's new corners once an edit press ends. */
  onRingChanged?: (polygon: number, ring: LngLat[]) => void;
  onRemoved?: (polygon: number) => void;
  onCornerCount?: (count: number) => void;
  onPointerTarget?: (target: PointerTarget) => void;
}

/**
 * Draws an area on the ground of the 3D view: each click places a corner where the pointer meets the
 * ground, a click on the first corner or a right-click closes the area, Escape abandons it. As in 2D, an area cannot
 * start on a building, which a click opens instead. onClose gets the corners as lon/lat. While no area is
 * being drawn, the drawn areas are edited as on the 2D map: the corner or edge point under the pointer is
 * marked, dragging a corner moves it, dragging an edge adds a corner, Alt+click deletes a corner of an area
 * with more than three and the whole area of a triangle, Shift+click deletes the area under the pointer.
 */
export function useAreaSketch3D(
  mapRef: React.RefObject<maplibregl.Map | null>,
  mapReady: boolean,
  olMap: OlMap,
  cancelTrigger: number,
  areas: LngLat[][] | undefined,
  callbacks: AreaSketch3DCallbacks,
): React.RefObject<AreaSketch3D | null> {
  const sketchRef = useRef<AreaSketch3D | null>(null);
  const on = useRef(callbacks);
  on.current = callbacks;
  const areasRef = useRef(areas);
  areasRef.current = areas;
  const enabled = !!callbacks.onClose;

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !enabled) return;
    const addLayers = () => { if (!map.getSource(SOURCE)) addSketchLayers(map); };
    if (map.isStyleLoaded()) addLayers();
    else map.once('idle', addLayers);

    let corners: LngLat[] = [];
    let cursor: LngLat | null = null;
    let nearStart = false;
    let handle: LngLat | null = null;
    const setData = (data: FeatureCollection) => (map.getSource(SOURCE) as maplibregl.GeoJSONSource | undefined)?.setData(data);
    const render = () => setData(sketchData(corners, cursor, nearStart, handle));
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
      if (wasOpen) {
        on.current.onOpenChange?.(false);
        on.current.onCornerCount?.(0);
      }
    };
    let target: PointerTarget = 'outside';
    const setTarget = (next: PointerTarget) => {
      if (next === target) return;
      target = next;
      on.current.onPointerTarget?.(next);
    };
    const isNearStart = (pixel: [number, number]) => {
      if (corners.length < 3) return false;
      const start = map.project(corners[0]);
      return Math.hypot(start.x - pixel[0], start.y - pixel[1]) < CLOSE_PX;
    };

    const close = () => {
      const ring = corners;
      reset();
      on.current.onClose?.(ring);
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
        if (corners.length === 1) on.current.onOpenChange?.(true);
        on.current.onCornerCount?.(corners.length);
        render();
        return true;
      },
      move: (pixel, onModelFeature) => {
        if (corners.length === 0) {
          if (dragging) return 'move';
          const hit = handleAt(pixel);
          const next = hit ? ground(hit.at) : null;
          if (next !== handle) { handle = next; render(); }
          setTarget(targetOf(hit, pixel, onModelFeature));
          if (hit) return 'move';
          return onModelFeature ? null : 'crosshair';
        }
        cursor = ground(pixel);
        nearStart = isNearStart(pixel);
        render();
        return 'crosshair';
      },
    };
    // Named as the 2D drawer names them, for the hints beside the cursor; an edge point is not a corner there.
    const targetOf = (hit: EditHandle | null, pixel: Pixel, onModelFeature: boolean): PointerTarget => {
      const rings = areasRef.current ?? [];
      if (hit && !hit.onEdge) return rings[hit.polygon].length <= 3 ? 'triangle-corner' : 'corner';
      if (areaAt(rings, ground(pixel)) >= 0) return 'polygon';
      return onModelFeature ? 'building' : 'outside';
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

    // The polygon being edited, with the corner the press moves; an edge press has added that corner.
    let dragging: { polygon: number; corner: number; ring: LngLat[]; moved: boolean } | null = null;
    const pixelOf = (e: PointerEvent): Pixel => {
      const box = map.getContainer().getBoundingClientRect();
      return [e.clientX - box.left, e.clientY - box.top];
    };
    const handleAt = (pixel: Pixel) => editHandleAt(areasRef.current ?? [], pixel, (c) => {
      const at = map.project(c);
      return [at.x, at.y];
    }, EDIT_PX);
    // Cancelling the press keeps it from the 2D map's click and from the pan that useMapLibreMap starts.
    const onCornerDown = (e: PointerEvent) => {
      if (!e.isTrusted || e.button !== 0 || corners.length > 0 || !viewport.contains(e.target as Node)) return;
      if (e.shiftKey) {
        const area = areaAt(areasRef.current ?? [], ground(pixelOf(e)));
        if (area < 0) return;
        e.preventDefault();
        e.stopPropagation();
        on.current.onRemoved?.(area);
        return;
      }
      const hit = handleAt(pixelOf(e));
      if (!hit) return;
      e.preventDefault();
      e.stopPropagation();
      const ring = [...(areasRef.current ?? [])[hit.polygon]];
      if (e.altKey) {
        // Deleting a corner of a triangle would leave no area, so the whole area goes, as in 2D.
        if (hit.onEdge) return;
        if (ring.length > 3) on.current.onRingChanged?.(hit.polygon, ring.filter((_, i) => i !== hit.corner));
        else on.current.onRemoved?.(hit.polygon);
        return;
      }
      if (hit.onEdge) ring.splice(hit.corner + 1, 0, ground(hit.at));
      dragging = { polygon: hit.polygon, corner: hit.onEdge ? hit.corner + 1 : hit.corner, ring, moved: false };
    };
    const onCornerMove = (e: PointerEvent) => {
      if (!dragging) return;
      const { polygon, corner, ring } = dragging;
      ring[corner] = ground(pixelOf(e));
      dragging.moved = true;
      handle = ring[corner];
      render();
      addOrUpdatePolygon(map, (areasRef.current ?? []).map((r, i) => (i === polygon ? ring : r)));
    };
    // A press on an edge that is not dragged adds no corner, as on the 2D map.
    const onCornerUp = () => {
      const done = dragging;
      dragging = null;
      if (done?.moved) on.current.onRingChanged?.(done.polygon, done.ring);
    };
    window.addEventListener('pointerdown', onCornerDown, true);
    window.addEventListener('pointermove', onCornerMove);
    window.addEventListener('pointerup', onCornerUp);
    const onLeave = () => {
      setTarget('outside');
      if (!cursor && !handle) return;
      cursor = null;
      handle = null;
      render();
    };
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
      if (corners.length > 0) {
        on.current.onOpenChange?.(false);
        on.current.onCornerCount?.(0);
      }
      map.off('remove', onRemove);
      map.off('idle', addLayers);
      if (!removed) setData(sketchData([], null, false));
    };
  }, [mapRef, mapReady, olMap, enabled, cancelTrigger]);

  return sketchRef;
}
