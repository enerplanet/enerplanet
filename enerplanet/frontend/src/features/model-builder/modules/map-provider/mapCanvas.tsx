/**
 * The provider's canvas: MapLibre, and the translation between the host's layer stack and a MapLibre style.
 *
 * **This is the only file that knows which engine is underneath**, which is the entire point of the provider
 * — it is a **blackbox**: swapping MapLibre for another engine means replacing this file, and
 * nothing outside it — not the frame, not a module — has to change.
 *
 * Deliberately **not unit-tested**: it needs a browser, WebGL and vector tiles. What it *decides* lives in
 * `capture.ts` and `mapHost.ts` (both tested); this file wires those decisions to MapLibre.
 *
 * The setup and the capture behaviour are the legacy's, on purpose — the MapLibre overlay's options, and the
 * `PolygonDrawer`'s way of drawing. Three of those behaviours are load-bearing, and each came from a real
 * failure:
 *
 *   - **dragPan is disabled while a capture runs.** Without it a click that slips a pixel or two is a *pan*, so
 *     no click event fires at all and the polygon can never be completed. The legacy disables it for the same
 *     reason ("a slip while placing a vertex cannot move it").
 *   - **The cursor goes on the map's canvas**, via `map.getCanvas()`. That is the element MapLibre sets
 *     `grab`/`grabbing` on, so setting it on the container leaves the engine's cursor showing through.
 *   - **A click near the first vertex closes the polygon**, with a marker that says so. The legacy's
 *     `SNAP_DISTANCE` affordance beats hoping someone discovers a double-click.
 */

import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import type { StyleSpecification } from "maplibre-gl";
import { useTranslation } from "@spatialhub/i18n";
import type { Extent, MapFeature } from "@model-builder/core";
import type { HostRuntime, MapRenderer } from "./mapHost";
import { captureCursor, pixelDistance, shouldClose, shouldTrimTail, startMarkerRadius } from "./capture";
import {
  CITY_3D_LAYER_ID,
  POLYGON_FILTER,
  cityBuildings3dLayer,
  extrusionIdOf,
  extrusionLayer,
  extrusionOpacityAt,
  hasOwnVolumes,
} from "./extrusion";

// maplibre-gl loads its worker relative to its own module, which Vite's dependency bundling moves; the worker
// file is self-contained, so its own URL works in dev and in a build. Same fix as the legacy overlay.
maplibregl.setWorkerUrl(workerUrl);

/**
 * OpenStreetMap: raster tiles, no API key — the standard OSM layer, the same one the legacy 2D map uses.
 *
 * Raster, so unlike the previous OpenFreeMap vector style it carries no `building` source-layer, and the map's
 * own 3D building fallback (`extrusion.ts`) simply does not apply — the city's volumes were the basemap's, and a
 * raster basemap has none to extrude. Module layers' own extrusions are unaffected.
 */
const BASE_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      maxzoom: 19,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    },
  },
  layers: [{ id: "osm", type: "raster", source: "osm" }],
};

const sourceOf = (id: string): string => `mb-source-${id}`;

/**
 * One module layer is three MapLibre layers, not one: a GeoJSON source can hold points, lines and polygons at
 * once, and MapLibre styles one geometry type per layer. They are added, ordered and removed together — and a
 * layer that asked for volume has a fourth, over the same source.
 */
const styleIdsOf = (id: string): readonly [string, string, string, string] => [
  `mb-layer-${id}-fill`,
  `mb-layer-${id}-line`,
  `mb-layer-${id}-circle`,
  extrusionIdOf(id),
];

/** The in-progress capture preview: its own source and layer, so no module layer is ever touched by it. */
const CAPTURE_SOURCE = "mb-capture-source";
const CAPTURE_LAYER = "mb-capture-line";

/** Where the start marker sits while capturing, in canvas pixels, and whether a click there would close. */
interface StartMarker {
  x: number;
  y: number;
  nearStart: boolean;
}

/** What is on the stack, as the GeoJSON features MapLibre draws — properties carried through untouched. */
function featuresOf(runtime: HostRuntime, id: string): GeoJSON.Feature[] {
  return runtime.stack.featuresOf(id).flatMap((feature) =>
    feature.geometry === undefined
      ? []
      : [
          {
            type: "Feature" as const,
            properties: { ...feature.properties },
            geometry: feature.geometry,
          },
        ],
  );
}

export const MapCanvas: React.FC<{ runtime: HostRuntime }> = ({ runtime }) => {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement | null>(null);
  // The start marker is real DOM rather than a map layer: it carries a translated label, and MapLibre labels
  // would need glyphs from the style for something this incidental.
  const [marker, setMarker] = useState<StartMarker | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return undefined;

    let map: maplibregl.Map | null = null;
    let detach: (() => void) | null = null;
    let cancelled = false;
    let stopCapture: (() => void) | null = null;
    let hasFitOnce = false;
    const rendered = new Set<string>();

    /** Layers the stack no longer has: drop the trio and its source. */
    const dropGone = (active: maplibregl.Map, wanted: ReadonlySet<string>): void => {
      for (const id of [...rendered]) {
        if (wanted.has(id)) continue;
        for (const layerId of styleIdsOf(id)) {
          if (active.getLayer(layerId)) active.removeLayer(layerId);
        }
        if (active.getSource(sourceOf(id))) active.removeSource(sourceOf(id));
        rendered.delete(id);
      }
    };

    /**
     * One layer: make sure its source and its trio exist, then push its features in.
     *
     * **The features go in *with* the source, not after it.** A `setData` on a source the style has not ingested
     * yet is dropped without a word, so a freshly added layer sat empty until some later sync happened to set it
     * again — which is why a grid arrived one layer per visit, and why the cables never showed at all while the
     * stack held every one of them.
     *
     * Failing here must not take the rest of the draw with it either: a throw in this loop used to abort every
     * layer after it and tell nobody.
     */
    /**
     * Every volume on the map at this pitch — which is only the layers that asked for one.
     *
     * They are the buildings a module put there, so they are the ones in hand; the basemap's own buildings are
     * never extruded, because a tilted map that showed every building of the city would show the ones outside the
     * area as loudly as the ones inside it.
     *
     * MapLibre cannot express the fade in the style (`pitch` is not an expression input), so it follows the map's
     * `pitch` event instead — the same approach the legacy map takes for its own 3D layers.
     */
    const setExtrusionOpacity = (active: maplibregl.Map, pitch: number): void => {
      const styleIds = [CITY_3D_LAYER_ID, ...runtime.stack.getLayerOrder().map(extrusionIdOf)];
      for (const styleId of styleIds) {
        if (active.getLayer(styleId) === undefined) continue;
        active.setPaintProperty(styleId, "fill-extrusion-opacity", extrusionOpacityAt(pitch));
      }
    };

    /**
     * The city's own buildings: added once, then shown or hidden to suit what else is on the map.
     *
     * They are the fallback, so they are visible until a module layer stands up volumes of its own — and hidden
     * from then on. Two volumes on one footprint is what looked broken; one layer with its visibility toggled is
     * what makes both states available without ever drawing both.
     */
    const applyCity3d = (active: maplibregl.Map): void => {
      if (active.getLayer(CITY_3D_LAYER_ID) === undefined) {
        const spec = cityBuildings3dLayer(active.getStyle());
        if (spec === undefined) return;
        active.addLayer(spec.layer, spec.beforeId);
        setExtrusionOpacity(active, active.getPitch());
      }
      active.setLayoutProperty(
        CITY_3D_LAYER_ID,
        "visibility",
        hasOwnVolumes(runtime.stack) ? "none" : "visible",
      );
    };

    const drawLayer = (active: maplibregl.Map, id: string): void => {
      try {
        const data: GeoJSON.FeatureCollection = {
          type: "FeatureCollection",
          features: [...featuresOf(runtime, id)],
        };
        const source = active.getSource(sourceOf(id)) as maplibregl.GeoJSONSource | undefined;

        if (source === undefined) {
          active.addSource(sourceOf(id), { type: "geojson", data });
        } else {
          source.setData(data);
        }

        if (!rendered.has(id)) {
          addLayerTrio(active, id);
          rendered.add(id);
        }

        // A layer that asked for volume gets a fourth MapLibre layer over the same source, guarded on the layer
        // itself rather than on `rendered`: an extrusion declared after the trio was drawn still has to appear.
        const extrusion = runtime.stack.optionsOf(id)?.extrusion;
        if (extrusion !== undefined && active.getLayer(extrusionIdOf(id)) === undefined) {
          active.addLayer(extrusionLayer(id, sourceOf(id), extrusion));
          setExtrusionOpacity(active, active.getPitch());
        }
      } catch (error) {
        console.error(`map layer "${id}" failed to draw`, error);
      }
    };

    /**
     * Bottom to top, each raised in turn — and the clickable layer raised last, so it is up front *without* the
     * stored order having been touched. That rule is the stack's (F); this only draws it.
     */
    const orderLayers = (active: maplibregl.Map, order: readonly string[], interactive: string | null): void => {
      const raise = (id: string): void => {
        for (const layerId of styleIdsOf(id)) {
          if (active.getLayer(layerId)) active.moveLayer(layerId);
        }
      };
      for (const id of order) raise(id);
      if (interactive !== null) raise(interactive);
      // After the clickable layer, never before: a layer that asked to sit on top is an annotation over the very
      // layer it marks, and the clickable raise above would otherwise bury it.
      for (const id of order) if (runtime.stack.optionsOf(id)?.onTop === true) raise(id);
    };

    /**
     * Draw the stack as it now stands.
     *
     * `ready` is the map's own `load` event saying the style is in place, and it is what makes the first draw
     * happen: inside that event `isStyleLoaded()` still reports false, so gating on it there would drop the only
     * call that can paint what the stack already holds.
     */
    const draw = (ready: boolean): void => {
      if (map === null || (!ready && !map.isStyleLoaded())) return;
      const active = map;
      const order = runtime.stack.getLayerOrder();
      dropGone(active, new Set(order));
      for (const id of order) drawLayer(active, id);
      orderLayers(active, order, runtime.stack.interactiveLayer());
      applyCity3d(active);
    };

    /**
     * Redraw, once per burst of stack changes rather than once per change.
     *
     * A module that draws its own layer changes the stack several times in a row — a create and a fill per layer —
     * and a draw taken between two of those changes paints a stack that is only half built and is never asked
     * again, because every later change was folded into the same turn. That is the whole of a bug that looked like
     * MapLibre refusing to overlay layers: a generated grid arrived as buildings on the map and cables in the
     * store, and nowhere.
     *
     * The `load` path draws immediately: it is a single call, there is nothing to coalesce with, and it is the
     * moment the map first becomes able to draw at all.
     */
    let queued = false;
    const sync = (ready = false): void => {
      if (ready) {
        draw(true);
        return;
      }
      if (queued) return;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        draw(false);
      });
    };

    /**
     * One module layer is three MapLibre layers over one source, because a source may hold points, lines and
     * polygons at once and MapLibre styles one geometry type per layer.
     *
     * **Each is filtered to the geometry it draws**, and that is the whole point: an unfiltered circle layer puts
     * a dot at every vertex of every geometry, so a grid came out as filled building areas dotted along their
     * corners, with the cables lost among them. Points belong to the circle layer, and nothing else does.
     */
    const addLayerTrio = (active: maplibregl.Map, id: string): void => {
      const [fill, line, circle] = styleIdsOf(id);
      const source = sourceOf(id);
      // A layer given its own colour is an annotation over something else, so it draws more solidly than the
      // default wash — that is what lets a highlight read against the layer it sits on.
      const color = runtime.stack.optionsOf(id)?.color;
      const fillColor = color ?? "#3b82f6";
      const lineColor = color ?? "#1e3a5f";
      active.addLayer({
        id: fill,
        type: "fill",
        source,
        filter: POLYGON_FILTER,
        paint: { "fill-color": fillColor, "fill-opacity": color === undefined ? 0.25 : 0.55 },
      });
      active.addLayer({
        id: line,
        type: "line",
        source,
        paint: { "line-color": lineColor, "line-width": color === undefined ? 2 : 3 },
      });
      active.addLayer({
        id: circle,
        type: "circle",
        source,
        // Points only. Without this a polygon earns a dot per vertex, which is noise that hides the network.
        filter: ["==", ["geometry-type"], "Point"],
        paint: { "circle-radius": 5, "circle-color": fillColor, "circle-stroke-width": 1.5, "circle-stroke-color": "#ffffff" },
      });
    };

    /** Publish a click: what was hit on the clickable layer (if anything), and where. */
    const onClick = (event: maplibregl.MapMouseEvent): void => {
      if (stopCapture !== null) return; // a capture owns the clicks while it runs
      const coordinates: [number, number] = [event.lngLat.lng, event.lngLat.lat];
      const interactive = runtime.stack.interactiveLayer();

      if (interactive === null) {
        runtime.publish({ coordinates });
        return;
      }

      const hit = event.target.queryRenderedFeatures(event.point, { layers: [...styleIdsOf(interactive)] });
      const first = hit[0];
      if (first === undefined || first.geometry === undefined) {
        runtime.publish({ coordinates });
        return;
      }
      runtime.publish({
        coordinates,
        feature: { properties: { ...(first.properties ?? {}) }, geometry: first.geometry as GeoJSON.Geometry },
      });
    };

    /**
     * Let the user draw one, the way the legacy drawer does: click to place corners and close by clicking the
     * start marker (right-click, Enter and a double-click also close). From three corners the preview closes,
     * so what the polygon will be is visible before it is finished.
     */
    const capture = (kind: "point" | "polygon"): Promise<MapFeature> => {
      if (map === null) return Promise.reject(new Error("the map canvas is not on screen yet"));
      const active = map;
      const canvas = active.getCanvas();

      return new Promise<MapFeature>((resolve, reject) => {
        const vertices: [number, number][] = [];
        let done = false;

        /** The preview: a line while there is nothing to enclose, the closed ring once there is. */
        const preview = (): void => {
          const source = active.getSource(CAPTURE_SOURCE) as maplibregl.GeoJSONSource | undefined;
          const geometry: GeoJSON.Geometry =
            vertices.length >= 3
              ? { type: "Polygon", coordinates: [[...vertices, vertices[0] as [number, number]]] }
              : { type: "LineString", coordinates: vertices };
          source?.setData({
            type: "FeatureCollection",
            features: [{ type: "Feature", properties: {}, geometry }],
          });
        };

        /** Where the start marker belongs now, and whether a click there would close the polygon. */
        const refreshMarker = (pointer?: [number, number]): void => {
          const first = vertices[0];
          if (first === undefined) {
            setMarker(null);
            return;
          }
          const start = active.project(first);
          const at: [number, number] = pointer ?? [start.x, start.y];
          const nearStart = shouldClose(pixelDistance(at, [start.x, start.y]), vertices.length);
          setMarker({ x: start.x, y: start.y, nearStart });
          canvas.style.cursor = captureCursor(nearStart);
        };

        const finish = (feature: MapFeature): void => {
          if (done) return;
          done = true;
          stop();
          resolve(feature);
        };

        const cancel = (): void => {
          if (done) return;
          done = true;
          stop();
          reject(new Error(`the ${kind} capture was cancelled`));
        };

        const closePolygon = (): void => {
          // Too few corners is not an area: keep drawing rather than failing the capture under the user.
          if (vertices.length < 3) return;
          // A double-click places a second corner on top of its first. Trim that one duplicate — and only a
          // genuine one, never below four corners, because removing a real corner leaves a polygon that cannot
          // close and a capture that hangs with nothing on screen to explain why.
          const last = vertices[vertices.length - 1];
          const before = vertices[vertices.length - 2];
          if (last !== undefined && before !== undefined) {
            const a = active.project(before);
            const b = active.project(last);
            if (shouldTrimTail(pixelDistance([a.x, a.y], [b.x, b.y]), vertices.length)) vertices.pop();
          }
          const start = vertices[0] as [number, number];
          finish({ properties: {}, geometry: { type: "Polygon", coordinates: [[...vertices, start]] } });
        };

        const onCaptureClick = (event: maplibregl.MapMouseEvent): void => {
          const coordinates: [number, number] = [event.lngLat.lng, event.lngLat.lat];
          if (kind === "point") {
            finish({ properties: {}, geometry: { type: "Point", coordinates } });
            return;
          }
          // Checked before adding, so the closing click does not also land a corner on the first one.
          const first = vertices[0];
          if (first !== undefined) {
            const start = active.project(first);
            const distance = pixelDistance([event.point.x, event.point.y], [start.x, start.y]);
            if (shouldClose(distance, vertices.length)) {
              closePolygon();
              return;
            }
          }
          vertices.push(coordinates);
          preview();
          refreshMarker([event.point.x, event.point.y]);
        };

        const onCaptureMove = (event: maplibregl.MapMouseEvent): void => {
          refreshMarker([event.point.x, event.point.y]);
        };

        const onCaptureDoubleClick = (): void => {
          // Both clicks of the pair place a corner; closePolygon trims the duplicate. Popping here instead lost a
          // real corner whenever the user drew three and double-clicked to finish — the polygon then had too few
          // corners to close, so the capture hung and the module never received anything.
          closePolygon();
        };

        const onCaptureContextMenu = (event: maplibregl.MapMouseEvent): void => {
          event.preventDefault();
          closePolygon();
        };

        const onKey = (event: KeyboardEvent): void => {
          if (event.key === "Escape") cancel();
          if (event.key === "Enter" && kind === "polygon") closePolygon();
        };

        const stop = (): void => {
          active.off("click", onCaptureClick);
          active.off("mousemove", onCaptureMove);
          active.off("dblclick", onCaptureDoubleClick);
          active.off("contextmenu", onCaptureContextMenu);
          window.removeEventListener("keydown", onKey);
          // Hand the map back as it was: panning is a capture's to take and to return.
          active.dragPan.enable();
          canvas.style.cursor = "";
          setMarker(null);
          if (active.getLayer(CAPTURE_LAYER)) active.removeLayer(CAPTURE_LAYER);
          if (active.getSource(CAPTURE_SOURCE)) active.removeSource(CAPTURE_SOURCE);
          stopCapture = null;
        };

        if (!active.getSource(CAPTURE_SOURCE)) {
          active.addSource(CAPTURE_SOURCE, {
            type: "geojson",
            data: { type: "FeatureCollection", features: [] },
          });
        }
        if (!active.getLayer(CAPTURE_LAYER)) {
          active.addLayer({
            id: CAPTURE_LAYER,
            type: "line",
            source: CAPTURE_SOURCE,
            paint: { "line-color": "#f59e0b", "line-width": 2, "line-dasharray": [2, 1] },
          });
        }

        // A slip of a pixel or two would otherwise pan the map and swallow the click, so panning waits until
        // the polygon is closed. The legacy does the same, for the same reason.
        active.dragPan.disable();
        canvas.style.cursor = captureCursor(false);

        active.on("click", onCaptureClick);
        active.on("mousemove", onCaptureMove);
        active.on("dblclick", onCaptureDoubleClick);
        active.on("contextmenu", onCaptureContextMenu);
        window.addEventListener("keydown", onKey);
        stopCapture = stop;
      });
    };

    const fit = (extent: Extent): void => {
      if (map === null) return;
      const [west, south, east, north] = extent;
      map.fitBounds(
        [
          [west, south],
          [east, north],
        ],
        { padding: 40, duration: hasFitOnce ? 600 : 0 },
      );
      hasFitOnce = true;
    };

    /**
     * Build the map once the box has a size. A MapLibre map created in a zero-height container comes up blank —
     * the legacy hit this too — and on the first frame the slot often has no height yet, so this is driven by
     * the observer below rather than by mount alone.
     */
    const start = (): void => {
      if (cancelled || map !== null) return;
      if (container.clientWidth === 0 || container.clientHeight === 0) return;

      const created = new maplibregl.Map({
        container,
        style: BASE_STYLE,
        center: [8.6, 49.4],
        zoom: 11,
        pitch: 0,
        bearing: 0,
        maxPitch: 85,
        attributionControl: false,
        doubleClickZoom: false, // do not zoom while a polygon is being closed
        dragRotate: true, // right-click rotate, the 3D gesture the legacy uses
        boxZoom: false,
        keyboard: false,
      });

      let lastPitch = Number.NaN;
      created.on("pitch", () => {
        const pitch = created.getPitch();
        if (Math.abs(pitch - lastPitch) < 0.5) return;
        lastPitch = pitch;
        setExtrusionOpacity(created, pitch);
      });

      created.on("load", () => {
        if (!cancelled) sync(true);
      });
      created.on("click", onClick);
      map = created;

      /**
       * A dev aid, not a feature. The draw has failed invisibly twice now, and the layer state is what says
       * whether the stack ever held a layer or the map never drew it — two causes that look identical on screen.
       * In the console: `__mbMap.stack.getLayerOrder()`, and `__mbMap.stack.featuresOf("lines").length`.
       */
      if (import.meta.env.DEV) {
        (window as { __mbMap?: unknown }).__mbMap = {
          map: created,
          stack: runtime.stack,
        };
      }

      const renderer: MapRenderer = { sync, fit, capture };
      detach = runtime.attach(renderer);
    };

    const observer = new ResizeObserver(() => {
      if (map === null) {
        start();
        return;
      }
      map.resize();
    });
    observer.observe(container);
    start();

    return () => {
      cancelled = true;
      observer.disconnect();
      stopCapture?.();
      detach?.();
      map?.remove();
      map = null;
    };
  }, [runtime]);

  return (
    <div ref={containerRef} className="relative h-full w-full">
      {marker !== null && (
        // The start marker: a dot that grows when a click there would close the polygon, and says so.
        <div
          className="pointer-events-none absolute z-10 flex -translate-x-1/2 -translate-y-1/2 items-center gap-1"
          style={{ left: marker.x, top: marker.y }}
        >
          <span
            className="block rounded-full border-2 border-cyan-700 bg-cyan-500"
            style={{ width: startMarkerRadius(marker.nearStart), height: startMarkerRadius(marker.nearStart) }}
          />
          <span className="whitespace-nowrap rounded bg-white/90 px-1.5 py-0.5 text-[11px] font-medium text-cyan-700 shadow-sm">
            {marker.nearStart
              ? t("modelBuilder.map-provider.clickToClose")
              : t("modelBuilder.map-provider.start")}
          </span>
        </div>
      )}
    </div>
  );
};
