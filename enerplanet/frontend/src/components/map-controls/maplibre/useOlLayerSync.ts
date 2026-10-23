import { useEffect, useRef } from 'react';
import type { Map as OlMap } from 'ol';
import Modify from 'ol/interaction/Modify';
import Draw from 'ol/interaction/Draw';

const OL_HIDDEN_CLASS = 'ol-3d-hidden';
let styleInjected = false;

function ensureHidingStyle() {
  if (styleInjected) return;
  const style = document.createElement('style');
  style.setAttribute('data-ol-3d-hide', '');
  style.textContent = `
    .${OL_HIDDEN_CLASS} {
      opacity: 0 !important;
    }
    .${OL_HIDDEN_CLASS} canvas,
    .${OL_HIDDEN_CLASS} .ol-overlaycontainer,
    .${OL_HIDDEN_CLASS} .ol-overlaycontainer-stopevent,
    .${OL_HIDDEN_CLASS} .ol-layer {
      visibility: hidden !important;
      opacity: 0 !important;
    }
  `;
  document.head.appendChild(style);
  styleInjected = true;
}

// The 2D map is hidden only through OL_HIDDEN_CLASS on its viewport. Hiding its
// elements by inline style left a layer that OpenLayers detaches while hidden (the
// base layer in 3D) still hidden when it was attached again, blanking the 2D map.
export function useOlLayerSync(olMap: OlMap, visible: boolean, isDrawing: boolean) {
  const pendingTimeoutsRef = useRef<number[]>([]);
  const unmountedRef = useRef(false);

  const clearPendingTimeouts = () => {
    pendingTimeoutsRef.current.forEach((id) => clearTimeout(id));
    pendingTimeoutsRef.current = [];
  };

  const rerenderOlSafely = () => {
    if (unmountedRef.current) return;
    if (!olMap.getTargetElement()) return;

    olMap.getLayers().forEach((layer: any) => {
      layer.changed?.();
    });
    olMap.updateSize();
    olMap.renderSync();
  };

  useEffect(() => { ensureHidingStyle(); }, []);
  useEffect(() => () => {
    unmountedRef.current = true;
    clearPendingTimeouts();
  }, []);

  useEffect(() => {
    if (!visible) return;
    const viewport = olMap.getViewport();
    if (!viewport) return;
    const origZ = viewport.style.zIndex;

    viewport.style.zIndex = '2';
    viewport.classList.add(OL_HIDDEN_CLASS);

    return () => {
      viewport.classList.remove(OL_HIDDEN_CLASS);
      viewport.style.zIndex = origZ;

      // Force OL redraw when leaving 3D, but skip if route unmounted/detached.
      clearPendingTimeouts();
      rerenderOlSafely();

      const secondPassId = window.setTimeout(() => {
        if (unmountedRef.current) return;
        rerenderOlSafely();
      }, 200);
      pendingTimeoutsRef.current.push(secondPassId);

      const thirdPassId = window.setTimeout(() => {
        if (unmountedRef.current) return;
        rerenderOlSafely();
      }, 600);
      pendingTimeoutsRef.current.push(thirdPassId);
    };
  }, [olMap, visible]);

  const visibleRef = useRef(visible);
  useEffect(() => { visibleRef.current = visible; }, [visible]);

  useEffect(() => {
    if (!visible || !isDrawing) return;
    const viewport = olMap.getViewport();
    if (!viewport) return;

    viewport.classList.remove(OL_HIDDEN_CLASS);

    const hiddenLayers: any[] = [];
    const polygonZIndexMin = 2000;
    const polygonZIndexMax = 2004;

    olMap.getLayers().forEach((layer: any) => {
      const z = layer.getZIndex?.();
      const isPolygonLayer = z !== undefined && z >= polygonZIndexMin && z <= polygonZIndexMax;
      if (!isPolygonLayer && layer.getVisible()) {
        layer.setVisible(false);
        hiddenLayers.push(layer);
      }
    });

    const onLayerAdd = (e: any) => {
      const layer = e.element;
      const z = layer.getZIndex?.();
      const isPolygonLayer = z !== undefined && z >= polygonZIndexMin && z <= polygonZIndexMax;
      if (!isPolygonLayer && layer.getVisible()) {
        layer.setVisible(false);
        hiddenLayers.push(layer);
      }
    };
    olMap.getLayers().on('add', onLayerAdd);

    return () => {
      olMap.getLayers().un('add', onLayerAdd);
      hiddenLayers.forEach((layer) => layer.setVisible(true));
      // Only re-hide if still in 3D mode (drawing just stopped)
      if (visibleRef.current) viewport.classList.add(OL_HIDDEN_CLASS);
    };
  }, [olMap, visible, isDrawing]);

  useEffect(() => {
    if (!visible) return;
    if (isDrawing) return;

    const deactivated: { interaction: any; wasActive: boolean }[] = [];

    olMap.getInteractions().forEach((interaction) => {
      if (interaction instanceof Modify || interaction instanceof Draw) {
        const wasActive = interaction.getActive();
        if (wasActive) {
          interaction.setActive(false);
          deactivated.push({ interaction, wasActive });
        }
      }
    });

    return () => {
      deactivated.forEach(({ interaction, wasActive }) => {
        interaction.setActive(wasActive);
      });
    };
  }, [olMap, visible, isDrawing]);
}
