import { useEffect, useRef } from 'react';
import type maplibregl from 'maplibre-gl';
import type { Map as OlMap } from 'ol';
import { INTERACTIVE_LAYERS } from './maplibre-styles';

export interface InteractionCallbacks {
  onBuildingClick?: (properties: Record<string, any>, lngLat: [number, number]) => void;
  onTransformerClick?: (properties: Record<string, any>, lngLat: [number, number]) => void;
  onBuildingHover?: (properties: Record<string, any> | null, pixel: [number, number]) => void;
  onTransformerHover?: (properties: Record<string, any> | null, pixel: [number, number]) => void;
  onMvLineHover?: (properties: Record<string, any> | null, pixel: [number, number]) => void;
  onMapClick?: (lngLat: [number, number]) => void;
}

/**
 * Hook: Forward OL click/hover events to MapLibre queryRenderedFeatures.
 */
export function useMapLibreInteractions(
  mapRef: React.RefObject<maplibregl.Map | null>,
  olMap: OlMap,
  visible: boolean,
  callbacks: InteractionCallbacks,
) {
  const cbRefs = useRef(callbacks);
  const activeClusterKeyRef = useRef<string | null>(null);
  cbRefs.current = callbacks;

  useEffect(() => {
    if (!visible) return;

    const getClusterKeyFromProps = (properties: Record<string, any> | null | undefined): string | null => {
      if (!properties) return null;
      if (typeof properties._cluster_key === 'string' && properties._cluster_key.trim()) {
        return properties._cluster_key.trim();
      }
      const rawId =
        properties.grid_result_id ??
        properties.transformer_id ??
        properties.trafo_id ??
        properties.cluster_id ??
        properties.id;
      if (rawId === undefined || rawId === null) return null;
      if (typeof rawId === 'number' && Number.isFinite(rawId)) {
        return `n:${rawId}`;
      }
      const rawText = String(rawId).trim();
      if (!rawText) return null;
      const num = Number(rawText);
      if (Number.isFinite(num)) {
        return `n:${num}`;
      }
      return `s:${rawText}`;
    };

    const setConnectedBuildingsFilter = (clusterKey: string | null) => {
      const map = mapRef.current;
      if (!map) return;
      if (activeClusterKeyRef.current === clusterKey) return;
      activeClusterKeyRef.current = clusterKey;

      const filter = clusterKey
        ? (['==', ['get', '_cluster_key'], clusterKey] as any)
        : (['==', ['get', '_cluster_key'], '__none__'] as any);

      for (const layerId of ['buildings-3d-connected', 'buildings-3d-connected-halo', 'buildings-3d-connected-outline']) {
        if (map.getLayer(layerId)) {
          map.setFilter(layerId, filter);
        }
      }

      // De-emphasize non-connected buildings while transformer is hovered.
      if (map.getLayer('buildings-3d-extrusion')) {
        map.setPaintProperty(
          'buildings-3d-extrusion',
          'fill-extrusion-opacity',
          clusterKey ? 0.32 : 0.9
        );
      }
      if (map.getLayer('buildings-3d-shadow')) {
        map.setPaintProperty(
          'buildings-3d-shadow',
          'fill-opacity',
          clusterKey ? 0.05 : 0.15
        );
      }
    };

    const queryFeatures = (pixel: [number, number]) => {
      const map = mapRef.current;
      if (!map) return null;
      const layers = INTERACTIVE_LAYERS.filter(id => {
        try { return !!map.getLayer(id); } catch { return false; }
      });
      if (!layers.length) return null;
      const features = map.queryRenderedFeatures(pixel, { layers });
      return features.length > 0 ? features[0] : null;
    };

    const handleClick = (evt: any) => {
      const pixel: [number, number] = [evt.pixel[0], evt.pixel[1]];
      const f = queryFeatures(pixel);
      if (f) {
        const layerId = f.layer.id;
        const props = f.properties || {};
        const lngLat = mapRef.current!.unproject(pixel);
        const coord: [number, number] = [lngLat.lng, lngLat.lat];
        if (layerId.startsWith('buildings-3d')) {
          cbRefs.current.onBuildingClick?.(props, coord);
        } else if (layerId.startsWith('transformers')) {
          cbRefs.current.onTransformerClick?.(props, coord);
        }
      } else {
        const map = mapRef.current;
        if (map) {
          const lngLat = map.unproject(pixel);
          cbRefs.current.onMapClick?.([lngLat.lng, lngLat.lat]);
        }
      }
    };

    let throttleTimeout: number | null = null;
    const handlePointerMove = (evt: any) => {
      if (throttleTimeout !== null) return;

      // Throttle to ~30fps for hover detection to preserve 60fps rendering
      throttleTimeout = window.setTimeout(() => {
        throttleTimeout = null;
        const pixel: [number, number] = [evt.pixel[0], evt.pixel[1]];
        const f = queryFeatures(pixel);

        if (f) {
          const layerId = f.layer.id;
          const props = f.properties || {};
          olMap.getTargetElement().style.cursor = 'pointer';

          if (layerId.startsWith('buildings-3d')) {
            setConnectedBuildingsFilter(null);
            cbRefs.current.onBuildingHover?.(props, pixel);
            cbRefs.current.onTransformerHover?.(null, pixel);
            cbRefs.current.onMvLineHover?.(null, pixel);
          } else if (layerId.startsWith('transformers')) {
            const clusterKey = getClusterKeyFromProps(props);
            setConnectedBuildingsFilter(clusterKey);
            cbRefs.current.onTransformerHover?.(props, pixel);
            cbRefs.current.onBuildingHover?.(null, pixel);
            cbRefs.current.onMvLineHover?.(null, pixel);
          } else if (layerId.startsWith('mv-lines') || layerId.startsWith('lv-lines')) {
            setConnectedBuildingsFilter(null);
            cbRefs.current.onMvLineHover?.(props, pixel);
            cbRefs.current.onBuildingHover?.(null, pixel);
            cbRefs.current.onTransformerHover?.(null, pixel);
          }
        } else {
          setConnectedBuildingsFilter(null);
          olMap.getTargetElement().style.cursor = '';
          cbRefs.current.onBuildingHover?.(null, pixel);
          cbRefs.current.onTransformerHover?.(null, pixel);
          cbRefs.current.onMvLineHover?.(null, pixel);
        }
      }, 32);
    };

    olMap.on('click', handleClick);
    olMap.on('pointermove', handlePointerMove);

    return () => {
      if (throttleTimeout !== null) clearTimeout(throttleTimeout);
      setConnectedBuildingsFilter(null);
      olMap.un('click', handleClick);
      olMap.un('pointermove', handlePointerMove);
    };
  }, [mapRef, olMap, visible]);
}
