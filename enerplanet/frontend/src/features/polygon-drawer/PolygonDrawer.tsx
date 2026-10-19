import { useEffect, useRef, useState, type FC } from "react";
import Draw, { type DrawEvent } from "ol/interaction/Draw";
import Modify, { type ModifyEvent } from "ol/interaction/Modify";
import DragPan from "ol/interaction/DragPan";
import VectorSource from "ol/source/Vector";
import VectorLayer from "ol/layer/Vector";
import { toLonLat, fromLonLat } from "ol/proj";
import type { Coordinate } from "ol/coordinate";
import type Polygon from "ol/geom/Polygon";
import type Map from "ol/Map";
import { Style, Fill, Stroke, Circle as CircleStyle, Text } from "ol/style";
import { Feature } from "ol";
import { MultiPoint, Polygon as OLPolygon, Point } from "ol/geom";
import { altKeyOnly, noModifierKeys, primaryAction, shiftKeyOnly } from "ol/events/condition";
import type MapBrowserEvent from "ol/MapBrowserEvent";
import { getArea } from "ol/sphere";
import buffer from "@turf/buffer";
import type { Feature as GeoJSONFeature, Polygon as GeoJSONPolygon, Position } from "geojson";
import { OVERVIEW_ZOOM } from "@/features/interactive-map/utils/mapStyleUtils";

/** What a click at the pointer would act on: a polygon corner (of a triangle), a polygon's inside, or empty map. */
export type PointerTarget = "corner" | "triangle-corner" | "polygon" | "outside";

// Modify's default pixelTolerance: the distance at which it picks up a vertex.
const CORNER_TOLERANCE_PX = 10;
// Below this a polygon covers nothing, e.g. corners that all lie on one line.
const MIN_POLYGON_AREA_M2 = 1;

interface PolygonDrawerProps {
  map: Map | null;
  onPolygonDrawn?: (coordinates: [number, number][], allPolygons: [number, number][][]) => void;
  onPolygonModified?: (allPolygons: [number, number][][]) => void;
  onDrawingChange?: (isDrawing: boolean) => void;
  onPointCountChange?: (count: number) => void;
  onClearAll?: () => void;
  /** True while another map tool owns clicks and the cursor; the drawer then does nothing. */
  suspended?: boolean;
  /** Called when a drawn or edited polygon is discarded for having no area. */
  onPolygonRejected?: () => void;
  /** Called when a right-click cannot close the sketch: too few corners, or all on one line. */
  onSketchCannotClose?: (reason: "too-few-corners" | "corners-in-line") => void;
  /** Called when the pointer moves onto a polygon corner, into a polygon, or out to empty map. */
  onPointerTargetChange?: (target: PointerTarget) => void;
  allowMultiple?: boolean;
  clearTrigger?: number;
  initialPolygons?: [number, number][][];
  bufferDistanceMeters?: number;
  /** If true, disables drawing after first polygon is created (unless cleared) */
  disableAfterDraw?: boolean;
  /** If true, only displays polygons without allowing editing */
  readOnly?: boolean;
  /** If true, enables polygon vertex editing (drag vertices, add/remove points) */
  enableEditing?: boolean;
  /** Translation labels */
  labels?: {
    clickToClose?: string;
    start?: string;
  };
}

export const PolygonDrawer: FC<PolygonDrawerProps> = ({
  map,
  onPolygonDrawn,
  onPolygonModified,
  onDrawingChange,
  onPointCountChange,
  onClearAll,
  onPointerTargetChange,
  onPolygonRejected,
  onSketchCannotClose,
  suspended = false,
  allowMultiple = false,
  clearTrigger = 0,
  initialPolygons,
  bufferDistanceMeters = 0,
  disableAfterDraw = false,
  readOnly = false,
  enableEditing = true,
  labels = {},
}) => {
  const onPolygonDrawnRef = useRef(onPolygonDrawn);
  const onPolygonModifiedRef = useRef(onPolygonModified);
  const onDrawingChangeRef = useRef(onDrawingChange);
  const onPointCountChangeRef = useRef(onPointCountChange);
  const onClearAllRef = useRef(onClearAll);
  const onPointerTargetChangeRef = useRef(onPointerTargetChange);
  const onPolygonRejectedRef = useRef(onPolygonRejected);
  const onSketchCannotCloseRef = useRef(onSketchCannotClose);
  const vectorSourceRef = useRef<VectorSource | null>(null);
  const bufferSourceRef = useRef<VectorSource | null>(null);
  const startPointSourceRef = useRef<VectorSource | null>(null);
  const allPolygonsRef = useRef<[number, number][][]>([]);
  const bufferDistanceRef = useRef<number>(bufferDistanceMeters);
  const drawInteractionRef = useRef<Draw | null>(null);
  const modifyInteractionRef = useRef<Modify | null>(null);
  const modifyDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [sourceReady, setSourceReady] = useState(false);
  // Read by the draw handlers so toggling multiple polygons does not rebuild the
  // layers, which would drop every polygon drawn so far.
  const allowMultipleRef = useRef(allowMultiple);
  const disableAfterDrawRef = useRef(disableAfterDraw);
  allowMultipleRef.current = allowMultiple;
  disableAfterDrawRef.current = disableAfterDraw;
  const suspendedRef = useRef(suspended);
  suspendedRef.current = suspended;

  useEffect(() => {
    bufferDistanceRef.current = bufferDistanceMeters;
  }, [bufferDistanceMeters]);

  useEffect(() => {
    onPolygonDrawnRef.current = onPolygonDrawn;
    onPolygonModifiedRef.current = onPolygonModified;
    onDrawingChangeRef.current = onDrawingChange;
    onPointCountChangeRef.current = onPointCountChange;
    onClearAllRef.current = onClearAll;
    onPointerTargetChangeRef.current = onPointerTargetChange;
    onPolygonRejectedRef.current = onPolygonRejected;
    onSketchCannotCloseRef.current = onSketchCannotClose;
  }, [onPolygonDrawn, onPolygonModified, onDrawingChange, onPointCountChange, onClearAll, onPointerTargetChange, onPolygonRejected, onSketchCannotClose]);

  useEffect(() => {
    if (clearTrigger > 0 && vectorSourceRef.current) {
      vectorSourceRef.current.clear();
      bufferSourceRef.current?.clear();
      startPointSourceRef.current?.clear();
      allPolygonsRef.current = [];
      // Re-enable draw interaction when cleared (check for duplicates)
      if (map && drawInteractionRef.current && disableAfterDrawRef.current && !allowMultipleRef.current) {
        const interactions = map.getInteractions().getArray();
        if (!interactions.includes(drawInteractionRef.current)) {
          map.addInteraction(drawInteractionRef.current);
        }
      }
    }
  }, [clearTrigger, map]);

  useEffect(() => {
    if (
      initialPolygons &&
      initialPolygons.length > 0 &&
      vectorSourceRef.current &&
      sourceReady &&
      map
    ) {
      // Clear existing features first
      vectorSourceRef.current.clear();
      allPolygonsRef.current = [];

      for (const polygonCoords of initialPolygons) {
        const mapCoords = polygonCoords.map(([lon, lat]) => fromLonLat([lon, lat]));
        mapCoords.push(mapCoords[0]);

        const polygon = new OLPolygon([mapCoords]);
        const feature = new Feature({ geometry: polygon });

        vectorSourceRef.current?.addFeature(feature);
        allPolygonsRef.current.push(polygonCoords);
      }
      if (bufferSourceRef.current && bufferDistanceRef.current > 0) {
        recomputeBuffers(bufferDistanceRef.current);
      }

      // Zoom to fit all polygons with a small delay to ensure map is ready
      const fitToExtent = () => {
        if (!vectorSourceRef.current) return;
        const extent = vectorSourceRef.current.getExtent();
        if (extent && extent[0] !== Infinity) {
          map.getView().fit(extent, {
            padding: [50, 50, 50, 50],
            duration: 1500,
            maxZoom: 18,
          });
        }
      };

      // Fit immediately and also after a short delay to handle refresh scenarios
      fitToExtent();
      const timer = setTimeout(fitToExtent, 300);

      // Disable drawing when initial polygons are loaded (edit mode)
      // Drawing will be re-enabled when user clears all polygons
      if (disableAfterDrawRef.current && !allowMultipleRef.current && drawInteractionRef.current) {
        map.removeInteraction(drawInteractionRef.current);
      }

      return () => clearTimeout(timer);
    }
  }, [initialPolygons, sourceReady, map]);

  // While another tool is active the drawer releases the cursor it set and stops drawing.
  useEffect(() => {
    if (!map || !suspended) return;
    drawInteractionRef.current?.setActive(false);
    map.getViewport().style.cursor = "";
  }, [map, suspended]);

  // Toggling multiple polygons only changes whether another polygon may be drawn.
  useEffect(() => {
    const draw = drawInteractionRef.current;
    if (!map || !draw) return;
    const onMap = map.getInteractions().getArray().includes(draw);
    const mayDraw = allowMultiple || !disableAfterDraw || allPolygonsRef.current.length === 0;
    if (mayDraw && !onMap) map.addInteraction(draw);
    if (!mayDraw && onMap) map.removeInteraction(draw);
  }, [map, allowMultiple, disableAfterDraw, sourceReady]);

  useEffect(() => {
    if (!map) {
      return;
    }

    const vectorSource = new VectorSource({ wrapX: false });
    vectorSourceRef.current = vectorSource;
    setSourceReady(true);

    const outlineStyle = new Style({
      fill: new Fill({
        color: "transparent",
      }),
      stroke: new Stroke({
        color: "#000000",
        width: 2.5,
      }),
    });
    // A marker on every corner shows where the polygon can be grabbed.
    const cornerStyle = new Style({
      geometry: (feature) => {
        const ring = (feature.getGeometry() as Polygon).getCoordinates()[0];
        return new MultiPoint(ring.slice(0, -1));
      },
      image: new CircleStyle({
        radius: 4,
        fill: new Fill({ color: "#ffffff" }),
        stroke: new Stroke({ color: "#111827", width: 1.5 }),
      }),
    });
    const vectorLayer = new VectorLayer({
      source: vectorSource,
      style: (_feature, resolution) =>
        (map.getView().getZoomForResolution(resolution) ?? Infinity) > OVERVIEW_ZOOM
          ? [outlineStyle, cornerStyle]
          : [outlineStyle],
      zIndex: 2000, // High z-index to ensure polygon stays on top of all grid layers
    });

    map.addLayer(vectorLayer);

    const bufferSource = new VectorSource({ wrapX: false });
    bufferSourceRef.current = bufferSource;
    const bufferLayer = new VectorLayer({
      source: bufferSource,
      style: new Style({
        fill: new Fill({ color: "rgba(251, 191, 36, 0.3)" }),
        stroke: new Stroke({ color: "#f59e0b", width: 3, lineDash: [8, 4] }),
      }),
      zIndex: 2001, // Above polygon layer
    });
    map.addLayer(bufferLayer);

    // Starting point indicator layer
    const startPointSource = new VectorSource({ wrapX: false });
    startPointSourceRef.current = startPointSource;
    const startPointLayer = new VectorLayer({
      source: startPointSource,
      style: (feature) => {
        const isNearStart = feature.get("isNearStart");
        return new Style({
          image: new CircleStyle({
            radius: isNearStart ? 12 : 8,
            fill: new Fill({ color: isNearStart ? "#06b6d4" : "#06b6d4" }), // cyan-500
            stroke: new Stroke({
              color: isNearStart ? "#0891b2" : "#0e7490", // cyan-600/700
              width: isNearStart ? 3 : 2,
            }),
          }),
          text: new Text({
            text: isNearStart
              ? (labels.clickToClose ?? "Click to close")
              : (labels.start ?? "Start"),
            offsetY: isNearStart ? -22 : -18,
            font: isNearStart
              ? "bold 12px Inter, system-ui, sans-serif"
              : "11px Inter, system-ui, sans-serif",
            fill: new Fill({ color: "#0e7490" }), // cyan-700
            stroke: new Stroke({ color: "#ffffff", width: 3 }),
            padding: [2, 4, 2, 4],
          }),
        });
      },
      zIndex: 2002, // Above buffer layer
    });
    map.addLayer(startPointLayer);

    // Snap distance in pixels for detecting proximity to start point
    const SNAP_DISTANCE = 20;
    const DRAW_SKETCH_Z_INDEX = 2003;
    const MODIFY_SKETCH_Z_INDEX = 2004;
    let startCoord: Coordinate | null = null;
    let isNearStartPoint = false;

    const sketchStyle = new Style({
      fill: new Fill({ color: "rgba(0, 0, 0, 0.05)" }),
      stroke: new Stroke({ color: "#000000", width: 2, lineDash: [4, 4] }),
    });

    const hasNoArea = (geom: Polygon) => getArea(geom, { projection: map.getView().getProjection() }) < MIN_POLYGON_AREA_M2;
    let spaceHeld = false;
    let removePanHandlers: (() => void) | null = null;
    let handleContextMenu: ((e: MouseEvent) => void) | null = null;
    let handleKeyDown: ((e: KeyboardEvent) => void) | null = null;
    let handleShiftClick: ((evt: MapBrowserEvent) => void) | null = null;
    let handlePointerMove: ((evt: MapBrowserEvent) => void) | null = null;

    // Only add draw interaction if not in readOnly mode
    if (!readOnly) {
      const draw = new Draw({
        source: vectorSource,
        type: "Polygon",
        style: sketchStyle,
        // Primary button only, so a right-click never adds a vertex or starts a new sketch. With several
        // polygons allowed, a click inside a drawn polygon selects what is there instead of adding a vertex.
        condition: (event) =>
          primaryAction(event) &&
          noModifierKeys(event) &&
          !spaceHeld &&
          !suspendedRef.current &&
          !(allowMultipleRef.current && vectorSource.getFeaturesAtCoordinate(event.coordinate).length > 0),
      });
      drawInteractionRef.current = draw;

      map.addInteraction(draw);
      draw.getOverlay().setZIndex(DRAW_SKETCH_Z_INDEX);

      // Track the first point during drawing
      let isFirstPoint = true;

      draw.on("drawstart", (event: DrawEvent) => {
        if (!allowMultipleRef.current) {
          vectorSource.clear();
          bufferSourceRef.current?.clear();
          startPointSourceRef.current?.clear();
          allPolygonsRef.current = [];
        }

        isFirstPoint = true;
        startCoord = null;
        isNearStartPoint = false;

        // Listen to geometry changes to show starting point and track point count
        const sketch = event.feature;
        const geom = sketch.getGeometry() as Polygon;

        geom.on("change", () => {
          const coords = geom.getCoordinates()[0];
          const pointCount = sketchVertexCount(geom);
          if (onPointCountChangeRef.current) {
            onPointCountChangeRef.current(pointCount);
          }

          if (coords.length > 0 && isFirstPoint) {
            isFirstPoint = false;
            startCoord = coords[0];
            // Add starting point marker
            const startPoint = new Feature({
              geometry: new Point(coords[0]),
            });
            startPoint.set("isNearStart", false);
            startPointSourceRef.current?.clear();
            startPointSourceRef.current?.addFeature(startPoint);
          }

          // Check if cursor is near start point (need at least 3 points to close)
          if (startCoord && sketchVertexCount(geom) >= 3) {
            const cursorCoord = coords[coords.length - 2];
            const startPixel = map.getPixelFromCoordinate(startCoord);
            const cursorPixel = map.getPixelFromCoordinate(cursorCoord);

            if (startPixel && cursorPixel) {
              const distance = Math.sqrt(
                Math.pow(startPixel[0] - cursorPixel[0], 2) +
                  Math.pow(startPixel[1] - cursorPixel[1], 2)
              );

              const wasNear = isNearStartPoint;
              isNearStartPoint = distance < SNAP_DISTANCE;

              // Update start point feature style when near state changes
              if (wasNear !== isNearStartPoint) {
                const features = startPointSourceRef.current?.getFeatures();
                if (features && features.length > 0) {
                  features[0].set("isNearStart", isNearStartPoint);
                }

                applyCursor();
              }
            }
          }
        });

        if (onDrawingChangeRef.current) {
          onDrawingChangeRef.current(true);
        }
      });

      draw.on("drawend", (event: DrawEvent) => {
        // Clear the starting point marker when drawing completes
        startPointSourceRef.current?.clear();
        startCoord = null;
        isNearStartPoint = false;

        // Reset point count
        if (onPointCountChangeRef.current) {
          onPointCountChangeRef.current(0);
        }

        const polygon = event.feature.getGeometry() as Polygon;
        const coords = polygon.getCoordinates()[0];

        // Draw adds the feature to the source right after drawend, so it is removed once added.
        if (hasNoArea(polygon)) {
          vectorSource.once("addfeature", (e) => { if (e.feature) vectorSource.removeFeature(e.feature); });
          onDrawingChangeRef.current?.(false);
          onPolygonRejectedRef.current?.();
          return;
        }

        let lonLatCoords = coords.map((coord: Coordinate) => {
          const [lon, lat] = toLonLat(coord);
          return [lon, lat] as [number, number];
        });

        if (
          lonLatCoords.length > 2 &&
          lonLatCoords[0][0] === lonLatCoords.at(-1)?.[0] &&
          lonLatCoords[0][1] === lonLatCoords.at(-1)?.[1]
        ) {
          lonLatCoords = lonLatCoords.slice(0, -1);
        }

        allPolygonsRef.current.push(lonLatCoords);

        if (onPolygonDrawnRef.current) {
          onPolygonDrawnRef.current(lonLatCoords, [...allPolygonsRef.current]);
        }

        if (bufferSourceRef.current && bufferDistanceRef.current > 0) {
          recomputeBuffers(bufferDistanceRef.current);
        }

        if (onDrawingChangeRef.current) {
          onDrawingChangeRef.current(false);
        }

        // Disable drawing after first polygon if disableAfterDraw is true
        if (disableAfterDrawRef.current && !allowMultipleRef.current) {
          map.removeInteraction(draw);
        }
      });

      // Add Modify interaction for editing polygon vertices if enabled
      if (enableEditing) {
        const modify = new Modify({
          source: vectorSource,
          deleteCondition: (event) => altKeyOnly(event) && event.type === "singleclick",
          // Style for vertices during editing
          style: new Style({
            image: new CircleStyle({
              radius: 6,
              fill: new Fill({ color: "#06b6d4" }), // cyan-500
              stroke: new Stroke({ color: "#0891b2", width: 2 }), // cyan-600
            }),
          }),
        });
        modifyInteractionRef.current = modify;
        map.addInteraction(modify);
        modify.getOverlay().setZIndex(MODIFY_SKETCH_Z_INDEX);

        // Modify inserts a vertex on pointerdown within pixelTolerance of an edge, so a press near the
        // boundary that is not dragged leaves an extra corner with the shape unchanged. Such a press is
        // undone: a corner made from an edge stays only once it is dragged.
        const polygonAreas = () =>
          vectorSource.getFeatures().map((f) => (f.getGeometry() as Polygon | undefined)?.getArea() ?? 0);
        const cornerTotal = () =>
          vectorSource.getFeatures().reduce((n, f) => n + (f.getGeometry() as Polygon).getCoordinates()[0].length, 0);
        let areasAtStart: number[] = [];
        let cornersAtStart = 0;
        let ringsAtStart: { feature: Feature; coords: Coordinate[][] }[] = [];
        modify.on("modifystart", () => {
          areasAtStart = polygonAreas();
          cornersAtStart = cornerTotal();
          ringsAtStart = vectorSource.getFeatures().map((f) => ({ feature: f, coords: (f.getGeometry() as Polygon).getCoordinates() }));
        });

        // Handle modification end - sync allPolygonsRef and notify parent
        modify.on("modifyend", (_event: ModifyEvent) => {
          const areas = polygonAreas();
          // Area equality misses a drag that keeps the area exactly; compare coordinates if that matters.
          const shapeUnchanged =
            areas.length === areasAtStart.length &&
            areas.every((a, i) => Math.abs(a - areasAtStart[i]) <= 1e-9 * Math.max(1, a));
          if (shapeUnchanged) {
            if (cornerTotal() > cornersAtStart) ringsAtStart.forEach(({ feature, coords }) => (feature.getGeometry() as Polygon).setCoordinates(coords));
            return;
          }
          const flattened = vectorSource.getFeatures().filter((f) => hasNoArea(f.getGeometry() as Polygon));
          flattened.forEach((f) => vectorSource.removeFeature(f));
          if (flattened.length > 0) onPolygonRejectedRef.current?.();
          const updatedPolygons = polygonsFromSource(vectorSource);

          // Update local state immediately
          allPolygonsRef.current = updatedPolygons;

          // Recompute buffers immediately for visual feedback
          if (bufferSourceRef.current && bufferDistanceRef.current > 0) {
            recomputeBuffers(bufferDistanceRef.current);
          }

          // Debounce only the API call (grid regeneration) to prevent rapid successive calls
          if (modifyDebounceRef.current) {
            clearTimeout(modifyDebounceRef.current);
          }

          modifyDebounceRef.current = setTimeout(() => {
            if (updatedPolygons.length === 0) onClearAllRef.current?.();
            else onPolygonModifiedRef.current?.([...updatedPolygons]);
          }, 300); // 300ms debounce for API call only
        });
      }

      // While sketching: right-click closes a polygon of three or more vertices, Escape abandons it.
      let sketching = false;
      let currentPointCount = 0;
      let sketchGeom: Polygon | null = null;
      const endSketch = () => {
        sketching = false;
        currentPointCount = 0;
        startPointSourceRef.current?.clear();
        onPointCountChangeRef.current?.(0);
        onDrawingChangeRef.current?.(false);
        syncPan();
        applyCursor();
      };
      handleContextMenu = (e: MouseEvent) => {
        if (!sketching) return;
        e.preventDefault();
        e.stopPropagation();
        if (currentPointCount < 3 || !sketchGeom) {
          onSketchCannotCloseRef.current?.("too-few-corners");
          return;
        }
        // The sketch ring ends with the cursor position and the closing vertex.
        const placed = sketchGeom.getCoordinates()[0].slice(0, -2);
        if (hasNoArea(new OLPolygon([[...placed, placed[0]]]))) {
          onSketchCannotCloseRef.current?.("corners-in-line");
          return;
        }
        drawInteractionRef.current?.finishDrawing();
      };
      handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === "Escape" && sketching) drawInteractionRef.current?.abortDrawing();
      };
      draw.on("drawstart", (evt: DrawEvent) => {
        sketching = true;
        currentPointCount = 0;
        syncPan();
        applyCursor();
        const geom = evt.feature.getGeometry() as Polygon;
        sketchGeom = geom;
        geom.on("change", () => {
          currentPointCount = sketchVertexCount(geom);
        });
      });
      draw.on("drawend", () => {
        sketching = false;
        currentPointCount = 0;
        syncPan();
        applyCursor();
      });
      draw.on("drawabort", endSketch);

      // While sketching, the map pans only with Space held, so a slip while placing a vertex cannot move
      // it. Space shows an open hand, a pan a closed fist. Space is taken only with the pointer on the map.
      const dragPans = map.getInteractions().getArray().filter((i): i is DragPan => i instanceof DragPan);
      const viewport = map.getViewport();
      let pointerOverMap = false;
      let buttonDown = false;
      let panning = false;
      let modifierHeld = false;
      function syncPan() {
        dragPans.forEach((p) => p.setActive(!sketching || spaceHeld));
      }
      // One place sets the cursor, so it always names the tool a click or drag would use: Space pans,
      // Alt picks a corner and Shift a polygon; otherwise drawing, or whatever is under the pointer.
      function applyCursor() {
        if (suspendedRef.current) return;
        let cursor = "";
        if (panning) cursor = "grabbing";
        else if (spaceHeld) cursor = "grab";
        else if (modifierHeld) cursor = "pointer";
        else if (sketching) cursor = isNearStartPoint ? "pointer" : "crosshair";
        else if (allowMultipleRef.current || targetFeature) cursor = cursorFor[pointerTarget];
        viewport.style.cursor = cursor;
      }
      const onKey = (e: KeyboardEvent) => {
        modifierHeld = e.altKey || e.shiftKey;
        if (e.code === "Space" && (e.type === "keyup" || pointerOverMap)) {
          if (pointerOverMap) e.preventDefault();
          spaceHeld = e.type === "keydown";
          syncPan();
        }
        applyCursor();
      };
      const onBlur = () => {
        spaceHeld = false;
        modifierHeld = false;
        syncPan();
        applyCursor();
      };
      const onEnter = () => { pointerOverMap = true; };
      const onLeave = () => { pointerOverMap = false; };
      const onDown = () => { buttonDown = true; };
      const onUp = () => { buttonDown = false; };
      const onMoveStart = () => {
        panning = buttonDown && (!sketching || spaceHeld);
        applyCursor();
      };
      const onMoveEnd = () => {
        panning = false;
        applyCursor();
      };
      document.addEventListener("keydown", onKey);
      document.addEventListener("keyup", onKey);
      window.addEventListener("blur", onBlur);
      viewport.addEventListener("pointerenter", onEnter);
      viewport.addEventListener("pointerleave", onLeave);
      viewport.addEventListener("pointerdown", onDown);
      document.addEventListener("pointerup", onUp);
      map.on("movestart", onMoveStart);
      map.on("moveend", onMoveEnd);
      removePanHandlers = () => {
        document.removeEventListener("keydown", onKey);
        document.removeEventListener("keyup", onKey);
        window.removeEventListener("blur", onBlur);
        viewport.removeEventListener("pointerenter", onEnter);
        viewport.removeEventListener("pointerleave", onLeave);
        viewport.removeEventListener("pointerdown", onDown);
        document.removeEventListener("pointerup", onUp);
        map.un("movestart", onMoveStart);
        map.un("moveend", onMoveEnd);
        dragPans.forEach((p) => p.setActive(true));
      };

      // Shift+click deletes the finished polygon under the cursor. Alt+click deletes a corner (Modify's
      // deleteCondition), except on a triangle, which Modify keeps: there it deletes the whole polygon.
      const removePolygon = (feature: Feature) => {
        vectorSource.removeFeature(feature);
        const remaining = polygonsFromSource(vectorSource);
        allPolygonsRef.current = remaining;
        recomputeBuffers(bufferDistanceRef.current);
        if (remaining.length === 0) onClearAllRef.current?.();
        else onPolygonModifiedRef.current?.(remaining);
      };
      const cornerFeatureAt = (pixel: number[]) =>
        enableEditing
          ? vectorSource.getFeatures().find((f) =>
              (f.getGeometry() as Polygon).getCoordinates()[0].some((c) => {
                const p = map.getPixelFromCoordinate(c);
                return p && Math.hypot(p[0] - pixel[0], p[1] - pixel[1]) <= CORNER_TOLERANCE_PX;
              })
            )
          : undefined;
      let pointerTarget: PointerTarget = "outside";
      let targetFeature: Feature | undefined;
      let onTriangleCorner = false;
      handleShiftClick = (evt: MapBrowserEvent) => {
        if (sketching || suspendedRef.current) return;
        if (shiftKeyOnly(evt)) {
          const hit = vectorSource.getFeaturesAtCoordinate(evt.coordinate)[0];
          if (hit) removePolygon(hit);
        } else if (altKeyOnly(evt) && onTriangleCorner && targetFeature) {
          removePolygon(targetFeature);
        }
      };
      map.on("singleclick", handleShiftClick);

      // Near a corner the cursor shows it can be moved. Inside a polygon the map is for selecting, so
      // drawing pauses and the cursor is a hand. Outside, a crosshair.
      const cursorFor: Record<PointerTarget, string> = {
        corner: "move",
        "triangle-corner": "move",
        polygon: "pointer",
        outside: "crosshair",
      };
      handlePointerMove = (evt: MapBrowserEvent) => {
        if (sketching || evt.dragging || spaceHeld || suspendedRef.current) return;
        let target: PointerTarget = "outside";
        onTriangleCorner = false;
        targetFeature = cornerFeatureAt(evt.pixel);
        if (targetFeature) {
          const corners = (targetFeature.getGeometry() as Polygon).getCoordinates()[0].length - 1;
          onTriangleCorner = corners <= 3;
          target = onTriangleCorner ? "triangle-corner" : "corner";
        } else if (vectorSource.getFeaturesAtCoordinate(evt.coordinate).length > 0) {
          target = "polygon";
        }
        if (allowMultipleRef.current) draw.setActive(target === "outside");
        const changed = target !== pointerTarget;
        pointerTarget = target;
        applyCursor();
        if (changed) onPointerTargetChangeRef.current?.(target);
      };
      map.on("pointermove", handlePointerMove);
      document.addEventListener("keydown", handleKeyDown);

      map.getViewport().addEventListener("contextmenu", handleContextMenu);
    }

    // Single cleanup function that handles all teardown
    return () => {
      if (handleContextMenu) {
        map.getViewport().removeEventListener("contextmenu", handleContextMenu);
      }
      if (handleKeyDown) document.removeEventListener("keydown", handleKeyDown);
      if (handleShiftClick) map.un("singleclick", handleShiftClick);
      if (handlePointerMove) map.un("pointermove", handlePointerMove);
      removePanHandlers?.();
      map.getViewport().style.cursor = "";
      if (drawInteractionRef.current) {
        map.removeInteraction(drawInteractionRef.current);
      }
      if (modifyInteractionRef.current) {
        map.removeInteraction(modifyInteractionRef.current);
      }
      if (modifyDebounceRef.current) {
        clearTimeout(modifyDebounceRef.current);
      }
      map.removeLayer(vectorLayer);
      map.removeLayer(bufferLayer);
      map.removeLayer(startPointLayer);
      vectorSourceRef.current = null;
      bufferSourceRef.current = null;
      startPointSourceRef.current = null;
      drawInteractionRef.current = null;
      modifyInteractionRef.current = null;
      modifyDebounceRef.current = null;
      allPolygonsRef.current = [];
      setSourceReady(false);
    };
  }, [map, readOnly, enableEditing]);

  const recomputeBuffers = (distanceMeters: number) => {
    const source = bufferSourceRef.current;
    if (!source) {
      return;
    }
    source.clear();
    if (!distanceMeters || distanceMeters <= 0) {
      return;
    }

    try {
      for (const lonLatCoords of allPolygonsRef.current) {
        processPolygonBuffer(lonLatCoords, distanceMeters, source);
      }
    } catch (e) {
      if (import.meta.env.DEV) console.warn("Buffer computation failed", e);
    }
  };

  useEffect(() => {
    recomputeBuffers(bufferDistanceMeters);
  }, [bufferDistanceMeters]);

  return null;
};

/** Vertices the user has placed: the sketch ring also holds the cursor position and the closing vertex. */
const sketchVertexCount = (geom: Polygon): number => Math.max(0, geom.getCoordinates()[0].length - 2);

/** The source's polygons as lon/lat rings, without the repeated closing vertex. */
const polygonsFromSource = (source: VectorSource): [number, number][][] => {
  const polygons: [number, number][][] = [];
  for (const feature of source.getFeatures()) {
    const geom = feature.getGeometry() as Polygon | undefined;
    if (!geom) continue;
    let ring = geom.getCoordinates()[0].map((coord: Coordinate) => toLonLat(coord) as [number, number]);
    if (ring.length > 2 && ring[0][0] === ring.at(-1)?.[0] && ring[0][1] === ring.at(-1)?.[1]) ring = ring.slice(0, -1);
    polygons.push(ring);
  }
  return polygons;
};

const processPolygonBuffer = (
  lonLatCoords: number[][],
  distanceMeters: number,
  source: VectorSource
) => {
  if (lonLatCoords.length < 3) return;

  const closed = [...lonLatCoords, lonLatCoords[0]];
  const feature: GeoJSONFeature<GeoJSONPolygon> = {
    type: "Feature",
    properties: {},
    geometry: { type: "Polygon", coordinates: [closed] },
  };

  const distanceKm = distanceMeters / 1000;
  const buffered = buffer(feature, distanceKm);

  if (!buffered?.geometry) {
    if (import.meta.env.DEV) console.warn("Buffer computation returned null or no geometry");
    return;
  }

  if (buffered.geometry.type === "Polygon") {
    const rings = buffered.geometry.coordinates[0] as [number, number][];
    const mapCoords = rings.map(([lon, lat]: [number, number]) => fromLonLat([lon, lat]));
    const poly = new OLPolygon([mapCoords]);
    const bufferFeature = new Feature({ geometry: poly });
    source.addFeature(bufferFeature);
  } else if (buffered.geometry.type === "MultiPolygon") {
    for (const polyCoords of buffered.geometry.coordinates) {
      const rings = polyCoords[0];
      const mapCoords = rings.map((pos: Position) => {
        const [lon, lat] = pos as [number, number];
        return fromLonLat([lon, lat]);
      });
      const poly = new OLPolygon([mapCoords]);
      const bufferFeature = new Feature({ geometry: poly });
      source.addFeature(bufferFeature);
    }
  }
};
