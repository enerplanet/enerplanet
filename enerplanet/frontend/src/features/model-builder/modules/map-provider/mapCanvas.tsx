/**
 * The provider's canvas: MapLibre, and the translation between the host's layer stack and a MapLibre style.
 *
 * The only file that knows which engine is underneath — swapping engines means replacing just this file.
 * Deliberately not unit-tested (needs a browser, WebGL and vector tiles); what it decides lives in
 * `capture.ts` and `mapHost.ts`, both tested.
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

// maplibre-gl loads its worker relative to its own module, which Vite's bundling moves; its own URL works in dev and build.
maplibregl.setWorkerUrl(workerUrl);

/** OpenStreetMap: raster tiles, no API key — the standard OSM layer. */
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

/** One module layer is a fill, a line, a circle, and an extrusion — MapLibre styles one geometry type per layer. */
const styleIdsOf = (id: string): readonly [string, string, string, string] => [
  `mb-layer-${id}-fill`,
  `mb-layer-${id}-line`,
  `mb-layer-${id}-circle`,
  extrusionIdOf(id),
];

/** The in-progress capture preview: its own source and layer, so no module layer is ever touched by it. */
const CAPTURE_SOURCE = "mb-capture-source";
const CAPTURE_LAYER = "mb-capture-line";

/**
 * The closest a fit may come. A model area is a few hundred metres across, so fitting its bounds exactly
 * lands around z19 and leaves no neighbourhood visible. This caps it; the area then fills part of the
 * view rather than all of it. Raise it to zoom in more, lower it for more context.
 */
const MAX_FIT_ZOOM = 18;

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
  // The start marker is real DOM rather than a map layer: it carries a translated label.
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
     * One layer: make sure its source and its trio exist, then push its features in — with the source, not after
     * it, or a `setData` against a source the style has not ingested is dropped. A throw here must not abort the
     * rest of the draw.
     */
    /** Every volume on the map at this pitch — only the layers that asked for one; the basemap's own are never extruded. */
    const setExtrusionOpacity = (active: maplibregl.Map, pitch: number): void => {
      const styleIds = [CITY_3D_LAYER_ID, ...runtime.stack.getLayerOrder().map(extrusionIdOf)];
      for (const styleId of styleIds) {
        if (active.getLayer(styleId) === undefined) continue;
        active.setPaintProperty(styleId, "fill-extrusion-opacity", extrusionOpacityAt(pitch));
      }
    };

    /** The city's own buildings: added once, then shown or hidden to suit what else is on the map. */
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

        // A layer that asked for volume gets a fourth layer over the same source, guarded on the layer itself.
        const extrusion = runtime.stack.optionsOf(id)?.extrusion;
        if (extrusion !== undefined && active.getLayer(extrusionIdOf(id)) === undefined) {
          active.addLayer(extrusionLayer(id, sourceOf(id), extrusion));
          setExtrusionOpacity(active, active.getPitch());
        }
      } catch (error) {
        console.error(`map layer "${id}" failed to draw`, error);
      }
    };

    /** Bottom to top, each raised in turn — and the clickable layer last, so it is up front without touching the stored order. */
    const orderLayers = (active: maplibregl.Map, order: readonly string[], interactive: string | null): void => {
      const raise = (id: string): void => {
        for (const layerId of styleIdsOf(id)) {
          if (active.getLayer(layerId)) active.moveLayer(layerId);
        }
      };
      for (const id of order) raise(id);
      if (interactive !== null) raise(interactive);
      // After the clickable layer, never before: an `onTop` layer marks the very layer a raise above would bury.
      for (const id of order) if (runtime.stack.optionsOf(id)?.onTop === true) raise(id);
    };

    /** Draw the stack as it now stands. `ready` is the map's `load` event, which makes the first draw happen. */
    const draw = (ready: boolean): void => {
      if (map === null || (!ready && !map.isStyleLoaded())) return;
      const active = map;
      const order = runtime.stack.getLayerOrder();
      dropGone(active, new Set(order));
      for (const id of order) drawLayer(active, id);
      orderLayers(active, order, runtime.stack.interactiveLayer());
      applyCity3d(active);
    };

    /** Redraw once per burst of stack changes, not once per change (a module fills a layer over several changes). */
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

    /** One module layer is three MapLibre layers over one source; each is filtered to the geometry it draws. */
    const addLayerTrio = (active: maplibregl.Map, id: string): void => {
      const [fill, line, circle] = styleIdsOf(id);
      const source = sourceOf(id);
      // A layer given its own colour draws more solidly than the default wash, so a highlight reads against its base.
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

    /** Let the user draw one: click to place corners, close by clicking the start marker (right-click, Enter, double-click). */
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
          // A double-click places a duplicate corner; trim that one, but never below four corners.
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
          // Both clicks of the pair place a corner; closePolygon trims the duplicate.
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

        // A slip of a pixel or two would pan the map and swallow the click, so panning waits until the polygon is closed.
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
        // `maxZoom` is the lever, not the padding: a model area is a few hundred metres across, so a bare
        // fit lands around z19 and fills the screen with it. Capping the zoom keeps the surrounding
        // neighbourhood in view. Padding is a margin only — at this scale it moves the zoom by ~0.1.
        { padding: 40, maxZoom: MAX_FIT_ZOOM, duration: hasFitOnce ? 600 : 0 },
      );
      hasFitOnce = true;
    };

    /** Build the map once the box has a size — a MapLibre map in a zero-height container comes up blank. */
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

      /** A dev aid, not a feature: inspect layer state via `__mbMap.stack` in the console. */
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
