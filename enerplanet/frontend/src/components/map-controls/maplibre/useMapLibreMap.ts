import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import { toLonLat, fromLonLat } from 'ol/proj';
import type { Map as OlMap } from 'ol';
import { DoubleClickZoom, DragPan, MouseWheelZoom, PinchZoom } from 'ol/interaction';
import { BASE_STYLE } from './maplibre-styles';

/**
 * Hook: Initialize and manage the MapLibre map instance.
 *
 * In 3D mode, MapLibre handles zoom, pan, and rotation natively for smooth
 * perspective-correct movement. Camera changes sync back to OL for state
 * consistency. During drawing mode, control reverts to OL for 2D polygon creation.
 */
export function useMapLibreMap(olMap: OlMap, visible: boolean, isDrawing: boolean = false) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const isDrawingRef = useRef(isDrawing);

  useEffect(() => { isDrawingRef.current = isDrawing; }, [isDrawing]);

  useEffect(() => {
    if (!containerRef.current || !visible) return;

    let map: maplibregl.Map | null = null;
    let cancelled = false;
    let cleanupFns: (() => void)[] = [];
    let retryInitTimeoutId: number | null = null;
    const resizeTimeoutIds: number[] = [];

    const rafId = requestAnimationFrame(() => {
      const container = containerRef.current;
      if (!container || cancelled) return;
      const rect = container.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) {
        retryInitTimeoutId = window.setTimeout(() => {
          if (cancelled || !containerRef.current) return;
          initMap(containerRef.current);
        }, 200);
        return;
      }
      initMap(container);
    });

    function initMap(container: HTMLDivElement) {
      if (cancelled || mapRef.current) return;

      const view = olMap.getView();
      const center = view.getCenter();
      const zoom = view.getZoom() ?? 14;
      const [lon, lat] = center ? toLonLat(center, view.getProjection()) : [0, 0];

      map = new maplibregl.Map({
        container,
        style: BASE_STYLE,
        center: [lon, lat],
        zoom: zoom - 1, // MapLibre zoom = OL zoom - 1
        pitch: 0,
        bearing: 0,
        maxPitch: 85,
        attributionControl: false,
        dragPan: true,          // Perspective-correct panning
        dragRotate: true,       // Right-click 3D rotation
        scrollZoom: true,       // Smooth animated zoom
        doubleClickZoom: false,
        touchZoomRotate: true,  // Mobile pinch-zoom/rotate
        boxZoom: false,
        keyboard: false,
      });

      // Prevent context menu during right-click rotation
      const onContextMenu = (e: MouseEvent) => { e.preventDefault(); };
      container.addEventListener('contextmenu', onContextMenu);

      // --- Bidirectional sync with feedback loop prevention ---
      let mlDriving = false;  // true when MapLibre is handling user interaction
      let olSyncRaf = 0;

      // OL → MapLibre sync (for programmatic OL view changes, e.g. fly-to)
      const syncOlToMl = () => {
        if (mlDriving) return;
        if (olSyncRaf) return;
        olSyncRaf = requestAnimationFrame(() => {
          olSyncRaf = 0;
          const mlMap = mapRef.current;
          if (!mlMap || mlDriving) return;
          const c = view.getCenter();
          const z = view.getZoom();
          if (!c || z === undefined) return;
          const [clon, clat] = toLonLat(c, view.getProjection());
          mlMap.jumpTo({ center: [clon, clat], zoom: z - 1 });
        });
      };

      view.on('change:center', syncOlToMl);
      view.on('change:resolution', syncOlToMl);

      // MapLibre → OL sync (when MapLibre handles user zoom/pan/rotate)
      const syncMlToOl = () => {
        const mlMap = mapRef.current;
        if (!mlMap) return;
        const c = mlMap.getCenter();
        const z = mlMap.getZoom();
        view.setCenter(fromLonLat([c.lng, c.lat], view.getProjection()));
        view.setZoom(z + 1);
      };

      map.on('move', () => {
        if (mlDriving) syncMlToOl();
      });

      map.on('movestart', (e: any) => {
        if (e.originalEvent) mlDriving = true;
      });

      map.on('moveend', () => {
        if (mlDriving) {
          syncMlToOl(); // Final sync for accuracy
          mlDriving = false;
        }
      });

      cleanupFns = [
        () => { view.un('change:center', syncOlToMl); },
        () => { view.un('change:resolution', syncOlToMl); },
        () => { container.removeEventListener('contextmenu', onContextMenu); },
        () => { if (olSyncRaf) cancelAnimationFrame(olSyncRaf); },
      ];

      mapRef.current = map;

      const createdMap = map;

      // Configure 3D lighting for realistic building shading
      createdMap.once('style.load', () => {
        if (cancelled || mapRef.current !== createdMap) return;
        try {
          createdMap.setLight({
            anchor: 'viewport',
            color: '#fdfcfa',
            intensity: 0.35,
            position: [1.4, 210, 40],
          });
        } catch {
          // Ignore late style events after teardown.
        }
      });

      const scheduleResize = (delayMs: number) => {
        const id = window.setTimeout(() => {
          if (cancelled || mapRef.current !== createdMap) return;
          try {
            createdMap.resize();
          } catch {
            // Ignore resize errors during fast route transitions.
          }
        }, delayMs);
        resizeTimeoutIds.push(id);
      };
      scheduleResize(100);
      scheduleResize(500);

      // --- Forward events from OL viewport to MapLibre ---
      const olViewport = olMap.getViewport();
      const mlCanvas = container.querySelector('canvas') as HTMLCanvasElement | null;

      // Forward wheel events for smooth animated zooming
      const onWheel = (e: WheelEvent) => {
        if (isDrawingRef.current) return; // Let OL handle during drawing
        e.preventDefault();
        e.stopPropagation();
        const target = mlCanvas || container;
        target.dispatchEvent(new WheelEvent('wheel', {
          deltaX: e.deltaX, deltaY: e.deltaY, deltaZ: e.deltaZ,
          deltaMode: e.deltaMode,
          clientX: e.clientX, clientY: e.clientY,
          ctrlKey: e.ctrlKey, shiftKey: e.shiftKey,
          bubbles: true, cancelable: true,
        }));
      };
      olViewport.addEventListener('wheel', onWheel, { passive: false, capture: true });

      // Forward mouse drag for perspective-correct panning and rotation.
      // Clicks (mousedown + mouseup without significant movement) are NOT
      // forwarded so OL's click detection continues to work for feature selection.
      let dragStartPos: { x: number; y: number } | null = null;
      let isDragging = false;
      const DRAG_THRESHOLD = 3; // pixels before treating as drag vs click

      const onMouseDown = (e: MouseEvent) => {
        if (isDrawingRef.current) return; // Let OL handle during drawing
        if (e.button === 2 || (e.button === 0 && e.ctrlKey)) {
          // Right-click or Ctrl+click → 3D rotation
          e.preventDefault();
          e.stopPropagation();
          isDragging = true;
          olViewport.style.pointerEvents = 'none';
          const target = mlCanvas || container;
          target.dispatchEvent(new MouseEvent('mousedown', {
            button: e.button, buttons: e.buttons,
            clientX: e.clientX, clientY: e.clientY,
            ctrlKey: e.ctrlKey, shiftKey: e.shiftKey,
            bubbles: true,
          }));
        } else if (e.button === 0 && !e.shiftKey) {
          // Left-click → track for potential pan drag
          dragStartPos = { x: e.clientX, y: e.clientY };
        }
      };

      const onMouseMove = (e: MouseEvent) => {
        if (isDrawingRef.current) return;
        if (dragStartPos && !isDragging) {
          const dx = e.clientX - dragStartPos.x;
          const dy = e.clientY - dragStartPos.y;
          if (Math.sqrt(dx * dx + dy * dy) > DRAG_THRESHOLD) {
            // Exceeded threshold — start MapLibre pan drag
            isDragging = true;
            olViewport.style.pointerEvents = 'none';
            const target = mlCanvas || container;
            // Send the initial mousedown at the drag start position
            target.dispatchEvent(new MouseEvent('mousedown', {
              button: 0, buttons: 1,
              clientX: dragStartPos.x, clientY: dragStartPos.y,
              bubbles: true,
            }));
            // Then the current mousemove
            target.dispatchEvent(new MouseEvent('mousemove', {
              button: 0, buttons: 1,
              clientX: e.clientX, clientY: e.clientY,
              bubbles: true,
            }));
          }
        }
      };

      const onMouseUp = () => {
        if (isDragging) {
          isDragging = false;
          olViewport.style.pointerEvents = '';
        }
        dragStartPos = null;
      };

      const onCtxMenu = (e: MouseEvent) => { e.preventDefault(); };

      olViewport.addEventListener('mousedown', onMouseDown);
      olViewport.addEventListener('mousemove', onMouseMove);
      olViewport.addEventListener('contextmenu', onCtxMenu);
      container.addEventListener('contextmenu', onCtxMenu);
      window.addEventListener('mouseup', onMouseUp);

      // Forward touch events for smooth mobile pinch-zoom/pan
      let touchDragging = false;

      const forwardTouchEvent = (e: TouchEvent, type: string) => {
        const target = mlCanvas || container;
        target.dispatchEvent(new TouchEvent(type, {
          touches: Array.from(e.touches),
          targetTouches: Array.from(e.targetTouches),
          changedTouches: Array.from(e.changedTouches),
          bubbles: true, cancelable: true,
        }));
      };

      const onTouchStart = (e: TouchEvent) => {
        if (isDrawingRef.current) return;
        if (e.touches.length >= 2) {
          // Multi-touch → forward for pinch-zoom/rotate
          e.preventDefault();
          touchDragging = true;
          olViewport.style.pointerEvents = 'none';
          forwardTouchEvent(e, 'touchstart');
        }
      };

      const onTouchMove = (e: TouchEvent) => {
        if (touchDragging) forwardTouchEvent(e, 'touchmove');
      };

      const onTouchEnd = (e: TouchEvent) => {
        if (touchDragging) {
          forwardTouchEvent(e, 'touchend');
          if (e.touches.length === 0) {
            touchDragging = false;
            olViewport.style.pointerEvents = '';
          }
        }
      };

      olViewport.addEventListener('touchstart', onTouchStart, { passive: false });
      olViewport.addEventListener('touchmove', onTouchMove, { passive: false });
      olViewport.addEventListener('touchend', onTouchEnd);

      cleanupFns.push(
        () => { olViewport.removeEventListener('wheel', onWheel, { capture: true } as any); },
        () => { olViewport.removeEventListener('mousedown', onMouseDown); },
        () => { olViewport.removeEventListener('mousemove', onMouseMove); },
        () => { olViewport.removeEventListener('contextmenu', onCtxMenu); },
        () => { container.removeEventListener('contextmenu', onCtxMenu); },
        () => { window.removeEventListener('mouseup', onMouseUp); },
        () => { olViewport.removeEventListener('touchstart', onTouchStart); },
        () => { olViewport.removeEventListener('touchmove', onTouchMove); },
        () => { olViewport.removeEventListener('touchend', onTouchEnd); },
        () => { olViewport.style.pointerEvents = ''; },
      );
    }

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      if (retryInitTimeoutId !== null) {
        clearTimeout(retryInitTimeoutId);
      }
      resizeTimeoutIds.forEach((id) => clearTimeout(id));
      cleanupFns.forEach(fn => fn());
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [olMap, visible]);

  // Disable OL zoom/pan interactions in 3D mode — MapLibre handles them.
  // Re-enable during drawing so OL 2D polygon creation works normally.
  useEffect(() => {
    if (!visible || isDrawing) return;
    const disabled: any[] = [];
    olMap.getInteractions().forEach((interaction) => {
      if (
        (interaction instanceof DragPan ||
         interaction instanceof MouseWheelZoom ||
         interaction instanceof PinchZoom) &&
        interaction.getActive()
      ) {
        interaction.setActive(false);
        disabled.push(interaction);
      }
    });

    return () => {
      disabled.forEach(i => i.setActive(true));
    };
  }, [olMap, visible, isDrawing]);

  // Disable OL DoubleClickZoom in 3D mode — it conflicts with polygon closing
  useEffect(() => {
    if (!visible) return;

    const deactivated: any[] = [];
    olMap.getInteractions().forEach((interaction) => {
      if (interaction instanceof DoubleClickZoom && interaction.getActive()) {
        interaction.setActive(false);
        deactivated.push(interaction);
      }
    });

    return () => {
      deactivated.forEach((interaction) => interaction.setActive(true));
    };
  }, [olMap, visible]);

  // Reset MapLibre pitch/bearing to 0 when drawing starts so OL 2D drawing
  // aligns with the MapLibre view.
  useEffect(() => {
    if (!visible || !isDrawing) return;
    const map = mapRef.current;
    if (!map) return;

    const prevPitch = map.getPitch();
    const prevBearing = map.getBearing();
    if (prevPitch !== 0 || prevBearing !== 0) {
      map.easeTo({ pitch: 0, bearing: 0, duration: 300 });
    }

    return () => {
      // Restore previous 3D view when drawing finishes
      const m = mapRef.current;
      if (m && (prevPitch !== 0 || prevBearing !== 0)) {
        m.easeTo({ pitch: prevPitch, bearing: prevBearing, duration: 300 });
      }
    };
  }, [visible, isDrawing]);

  return { containerRef, mapRef };
}
