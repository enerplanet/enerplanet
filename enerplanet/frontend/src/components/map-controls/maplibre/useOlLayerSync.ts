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

function hideViewportChildren(viewport: HTMLElement) {
  viewport.querySelectorAll('canvas, .ol-overlaycontainer, .ol-overlaycontainer-stopevent, .ol-layer').forEach((el) => {
    (el as HTMLElement).style.setProperty('visibility', 'hidden', 'important');
  });
}

function showViewportChildren(viewport: HTMLElement) {
  viewport.querySelectorAll('canvas, .ol-overlaycontainer, .ol-overlaycontainer-stopevent, .ol-layer').forEach((el) => {
    (el as HTMLElement).style.removeProperty('visibility');
  });
}

export function useOlLayerSync(olMap: OlMap, visible: boolean, isDrawing: boolean) {
  const observerRef = useRef<MutationObserver | null>(null);
  const activeRef = useRef(false);
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

    activeRef.current = true;
    viewport.style.zIndex = '2';
    viewport.classList.add(OL_HIDDEN_CLASS);
    hideViewportChildren(viewport);

    const observer = new MutationObserver(() => {
      if (activeRef.current) hideViewportChildren(viewport);
    });
    observer.observe(viewport, { childList: true, subtree: true });
    observerRef.current = observer;

    return () => {
      activeRef.current = false;
      observer.disconnect();
      observerRef.current = null;
      viewport.classList.remove(OL_HIDDEN_CLASS);
      showViewportChildren(viewport);
      viewport.style.zIndex = origZ;

      // Force OL redraw when leaving 3D, but skip if route unmounted/detached.
      clearPendingTimeouts();
      rerenderOlSafely();

      const secondPassId = window.setTimeout(() => {
        if (unmountedRef.current) return;
        showViewportChildren(viewport);
        rerenderOlSafely();
      }, 200);
      pendingTimeoutsRef.current.push(secondPassId);

      const thirdPassId = window.setTimeout(() => {
        if (unmountedRef.current) return;
        showViewportChildren(viewport);
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

    const observer = observerRef.current;
    if (observer) observer.disconnect();

    viewport.classList.remove(OL_HIDDEN_CLASS);
    showViewportChildren(viewport);

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
      if (visibleRef.current) {
        viewport.classList.add(OL_HIDDEN_CLASS);
        hideViewportChildren(viewport);
        if (observer) {
          observer.observe(viewport, { childList: true, subtree: true });
        }
      }
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
