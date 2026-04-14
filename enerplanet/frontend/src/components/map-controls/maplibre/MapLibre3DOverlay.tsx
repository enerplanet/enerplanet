import React from 'react';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Map as OlMap } from 'ol';
import { useMapLibreMap } from './useMapLibreMap';
import { useMapLibreLayers, type LayerData } from './useMapLibreLayers';
import { useMapLibreInteractions, type InteractionCallbacks } from './useMapLibreInteractions';
import { useOlLayerSync } from './useOlLayerSync';
import { MapLibre3DControls } from './MapLibre3DControls';

interface MapLibre3DOverlayProps extends LayerData, InteractionCallbacks {
  olMap: OlMap;
  visible: boolean;
  isDrawing?: boolean;
}

/**
 * MapLibre 3D overlay — renders 3D buildings, cables, transformers, and polygon boundary.
 * Composes separate hooks for map lifecycle, layers, interactions, and OL sync.
 */
export const MapLibre3DOverlay: React.FC<MapLibre3DOverlayProps> = ({
  olMap,
  visible,
  isDrawing = false,
  // Layer data
  buildingsGeoJSON,
  linesGeoJSON,
  mvLinesGeoJSON,
  transformersGeoJSON,
  availableBoundaryGeoJSON,
  selectedBoundaryFeature,
  showBoundary,
  polygonCoordinates,
  selectedBuildingOsmIds,
  isBuildingAssignMode,
  onBoundaryRegionClick,
  userModelGeoJSON,
  onUserModelClick,
  // Interaction callbacks
  onBuildingClick,
  onTransformerClick,
  onBuildingHover,
  onTransformerHover,
  onMvLineHover,
  onMapClick,
}) => {
  // 1. Map lifecycle & OL sync
  const { containerRef, mapRef } = useMapLibreMap(olMap, visible, isDrawing);

  // 2. Data layers
  useMapLibreLayers(mapRef, {
    buildingsGeoJSON, linesGeoJSON, mvLinesGeoJSON,
    transformersGeoJSON, availableBoundaryGeoJSON, selectedBoundaryFeature, showBoundary, polygonCoordinates,
    selectedBuildingOsmIds, isBuildingAssignMode, onBoundaryRegionClick, userModelGeoJSON, onUserModelClick,
  });

  // 3. Click/hover interactions (forwarded from OL events to MapLibre queryRenderedFeatures)
  useMapLibreInteractions(mapRef, olMap, visible, {
    onBuildingClick, onTransformerClick, onBuildingHover,
    onTransformerHover, onMvLineHover, onMapClick,
  });

  // 4. OL layer hiding & z-index management
  useOlLayerSync(olMap, visible, isDrawing);

  if (!visible) return null;

  return (
    <>
      {/* MapLibre canvas — behind OL viewport */}
      <div
        ref={containerRef}
        style={{
          position: 'absolute',
          top: 0, left: 0, right: 0, bottom: 0,
          zIndex: 0,
        }}
      />
      {/* 3D pitch/bearing/reset controls */}
      <MapLibre3DControls mapRef={mapRef} />
    </>
  );
};
