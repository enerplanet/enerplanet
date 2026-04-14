/**
 * Hook: Adds OpenLayers VectorLayers for region boundaries and user model polygons
 * on the /map page. Active for ALL non-MapLibre base layers (OSM, CartoDB, etc.).
 *
 * - Region boundaries: indigo fill + label (reuses boundaryStyleFunction)
 * - User models: green fill + label with hover highlight + click-to-navigate
 */
import { useEffect, useRef, useCallback } from 'react';
import type OLMap from 'ol/Map';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import GeoJSONFormat from 'ol/format/GeoJSON';
import { Style, Fill, Stroke, Text } from 'ol/style';
import { Point } from 'ol/geom';
import { getCenter } from 'ol/extent';
import type { Geometry } from 'ol/geom';
import type Feature from 'ol/Feature';
import type { FeatureLike } from 'ol/Feature';
import type MapBrowserEvent from 'ol/MapBrowserEvent';
import {
  boundaryStyleFunction,
  boundaryLabelStyle,
} from '@/features/interactive-map/utils/mapStyleUtils';

const BOUNDARY_LAYER_NAME = 'map-page-boundaries';
const MODEL_LAYER_NAME = 'map-page-user-models';

// ── User model styles (green theme) ──────────────────────────────────────

function userModelStyleFunction(feature: FeatureLike, resolution: number): Style[] {
  const isHovered = feature.get('_hovered') === true;
  const fillAlpha = isHovered ? 0.28 : 0.14;
  const strokeAlpha = isHovered ? 0.9 : 0.7;
  const strokeWidth = isHovered ? 2.5 : 1.8;

  const styles: Style[] = [
    new Style({
      fill: new Fill({ color: `rgba(16, 185, 129, ${fillAlpha})` }),
      stroke: new Stroke({ color: `rgba(5, 150, 105, ${strokeAlpha})`, width: strokeWidth }),
    }),
  ];

  // Label at medium zoom
  const title = feature.get('title');
  const geom = (feature as Feature<Geometry>).getGeometry();
  if (title && geom && resolution < 20) {
    const center = getCenter(geom.getExtent());
    const fontSize = resolution > 5 ? 10 : 12;
    styles.push(
      new Style({
        geometry: new Point(center),
        text: new Text({
          text: title,
          font: `600 ${fontSize}px Inter, -apple-system, BlinkMacSystemFont, sans-serif`,
          fill: new Fill({ color: '#064e3b' }),
          stroke: new Stroke({ color: 'rgba(255,255,255,0.92)', width: 3 }),
          backgroundFill: new Fill({ color: 'rgba(209, 250, 229, 0.90)' }),
          backgroundStroke: new Stroke({ color: 'rgba(16, 185, 129, 0.5)', width: 1 }),
          padding: [4, 8, 4, 8],
          overflow: true,
        }),
      }),
    );
  }

  return styles;
}

// ── Boundary style with label ────────────────────────────────────────────

function boundaryWithLabelStyle(feature: FeatureLike, resolution: number): Style[] {
  const styles = boundaryStyleFunction(feature as Feature<Geometry>, resolution);
  const name = feature.get('name');
  const geom = (feature as Feature<Geometry>).getGeometry();
  if (name && geom) {
    styles.push(boundaryLabelStyle(name, geom, resolution));
  }
  return styles;
}

// ── Hook ──────────────────────────────────────────────────────────────────

interface UseMapPageOLLayersOpts {
  map: OLMap | null;
  isMapLibre3D: boolean;
  availableBoundaryGeoJSON?: GeoJSON.FeatureCollection;
  userModelGeoJSON?: GeoJSON.FeatureCollection;
  onModelClick?: (modelId: number, status?: string) => void;
}

export function useMapPageOLLayers({
  map,
  isMapLibre3D,
  availableBoundaryGeoJSON,
  userModelGeoJSON,
  onModelClick,
}: UseMapPageOLLayersOpts) {
  const boundaryLayerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const modelLayerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const hoveredFeatureRef = useRef<Feature<Geometry> | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  const removeExistingLayers = useCallback((olMap: OLMap) => {
    const toRemove: VectorLayer<VectorSource>[] = [];
    olMap.getLayers().forEach((layer) => {
      const name = layer.get('name');
      if (name === BOUNDARY_LAYER_NAME || name === MODEL_LAYER_NAME) {
        toRemove.push(layer as VectorLayer<VectorSource>);
      }
    });
    toRemove.forEach((l) => olMap.removeLayer(l));
    boundaryLayerRef.current = null;
    modelLayerRef.current = null;
  }, []);

  // Add/remove layers when data or base layer changes
  useEffect(() => {
    if (!map) return;

    // Cleanup previous
    cleanupRef.current?.();
    cleanupRef.current = null;
    removeExistingLayers(map);

    // When MapLibre is active, MapLibre3DOverlay handles rendering
    if (isMapLibre3D) return;

    const format = new GeoJSONFormat();

    // ── Region boundaries ──
    if (availableBoundaryGeoJSON?.features?.length) {
      const features = format.readFeatures(availableBoundaryGeoJSON, {
        dataProjection: 'EPSG:4326',
        featureProjection: 'EPSG:3857',
      });

      const source = new VectorSource({ features });
      const layer = new VectorLayer({
        source,
        style: boundaryWithLabelStyle as unknown as import('ol/style/Style').StyleFunction,
        zIndex: 50,
        properties: { name: BOUNDARY_LAYER_NAME },
      });
      map.addLayer(layer);
      boundaryLayerRef.current = layer;
    }

    // ── User model polygons ──
    if (userModelGeoJSON?.features?.length) {
      const features = format.readFeatures(userModelGeoJSON, {
        dataProjection: 'EPSG:4326',
        featureProjection: 'EPSG:3857',
      });

      const source = new VectorSource({ features });
      const layer = new VectorLayer({
        source,
        style: userModelStyleFunction as unknown as import('ol/style/Style').StyleFunction,
        zIndex: 55,
        properties: { name: MODEL_LAYER_NAME },
      });
      map.addLayer(layer);
      modelLayerRef.current = layer;
    }

    // ── Hover interaction ──
    const handlePointerMove = (evt: MapBrowserEvent<PointerEvent>) => {
      if (evt.dragging) return;

      // Clear previous hover
      if (hoveredFeatureRef.current) {
        hoveredFeatureRef.current.set('_hovered', false);
        hoveredFeatureRef.current = null;
      }

      let cursor = '';
      map.forEachFeatureAtPixel(evt.pixel, (feature, layer) => {
        const layerName = layer?.get('name');
        if (layerName === MODEL_LAYER_NAME) {
          const f = feature as Feature<Geometry>;
          f.set('_hovered', true);
          hoveredFeatureRef.current = f;
          cursor = 'pointer';
          return true; // stop iteration
        }
        if (layerName === BOUNDARY_LAYER_NAME) {
          cursor = 'pointer';
          return true;
        }
        return false;
      });

      const target = map.getTargetElement();
      if (target) (target as HTMLElement).style.cursor = cursor;
    };

    // ── Click interaction ──
    const handleClick = (evt: MapBrowserEvent<PointerEvent>) => {
      map.forEachFeatureAtPixel(evt.pixel, (feature, layer) => {
        const layerName = layer?.get('name');
        if (layerName === MODEL_LAYER_NAME && onModelClick) {
          const modelId = feature.get('model_id');
          const status = feature.get('status');
          if (typeof modelId === 'number') {
            onModelClick(modelId, status);
            return true;
          }
        }
        return false;
      });
    };

    map.on('pointermove', handlePointerMove as any);
    map.on('click', handleClick as any);

    cleanupRef.current = () => {
      map.un('pointermove', handlePointerMove as any);
      map.un('click', handleClick as any);
      const target = map.getTargetElement();
      if (target) (target as HTMLElement).style.cursor = '';
    };

    return () => {
      cleanupRef.current?.();
      cleanupRef.current = null;
      removeExistingLayers(map);
    };
  }, [map, isMapLibre3D, availableBoundaryGeoJSON, userModelGeoJSON, onModelClick, removeExistingLayers]);
}
