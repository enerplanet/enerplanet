import React from 'react';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Map as OlMap } from 'ol';
import { useMapLibreMap } from './useMapLibreMap';
import { useMapLibreLayers, type LayerData } from './useMapLibreLayers';
import { useMapLibreInteractions, type InteractionCallbacks } from './useMapLibreInteractions';
import { useOlLayerSync } from './useOlLayerSync';
import { useAreaSketch3D } from './useAreaSketch3D';
import { MapLibre3DControls } from './MapLibre3DControls';
import type { MapControlsPlacement } from '@/components/map-controls/MapControls';

interface MapLibre3DOverlayProps extends LayerData, InteractionCallbacks {
  olMap: OlMap;
  visible: boolean;
  /** Draws areas on the ground when given, and gets each closed one as lon/lat corners. */
  onAreaDrawn?: (ring: [number, number][]) => void;
  /** Takes a corner of polygonCoordinates dragged to a new lon/lat; corners stay fixed without it. */
  onAreaCornerMoved?: (polygon: number, corner: number, to: [number, number]) => void;
  /** Called when the first corner of an area is placed (true) and when the area closes or is abandoned. */
  onSketchOpenChange?: (open: boolean) => void;
  /** Abandons the area being drawn whenever it changes. */
  cancelSketchTrigger?: number;
  /** Placement of the map's zoom buttons; the reset button sits under them. */
  controlsPlacement?: MapControlsPlacement;
}

/**
 * MapLibre 3D overlay — renders 3D buildings, cables, transformers, and polygon boundary.
 * Composes separate hooks for map lifecycle, layers, interactions, and OL sync.
 */
export const MapLibre3DOverlay: React.FC<MapLibre3DOverlayProps> = ({
  olMap,
  visible,
  onAreaDrawn,
  onAreaCornerMoved,
  onSketchOpenChange,
  cancelSketchTrigger = 0,
  controlsPlacement,
  // Layer data
  buildingsGeoJSON,
  linesGeoJSON,
  mvLinesGeoJSON,
  transformersGeoJSON,
  availableBoundaryGeoJSON,
  showBoundary,
  polygonCoordinates,
  selectedBuildingOsmIds,
  isBuildingAssignMode,
  onBoundaryRegionClick,
  userModelGeoJSON,
  onUserModelClick,
  techsFor,
  // Interaction callbacks
  onBuildingClick,
  onTransformerClick,
  onBuildingHover,
  onTransformerHover,
  onMvLineHover,
  onMapClick,
}) => {
  // 1. Map lifecycle & OL sync
  const { containerRef, mapRef, mapReady } = useMapLibreMap(olMap, visible);

  // 2. Data layers
  const { footprintOnly, lod2LayerRef } = useMapLibreLayers(mapRef, {
    buildingsGeoJSON, linesGeoJSON, mvLinesGeoJSON,
    transformersGeoJSON, availableBoundaryGeoJSON, showBoundary, polygonCoordinates,
    selectedBuildingOsmIds, isBuildingAssignMode, onBoundaryRegionClick, userModelGeoJSON, onUserModelClick, techsFor,
  }, mapReady);

  // 3. Click/hover interactions (forwarded from OL events to MapLibre queryRenderedFeatures)
  const sketchRef = useAreaSketch3D(
    mapRef, mapReady, olMap, onAreaDrawn, onSketchOpenChange, cancelSketchTrigger, polygonCoordinates, onAreaCornerMoved,
  );
  useMapLibreInteractions(mapRef, lod2LayerRef, olMap, visible, {
    onBuildingClick, onTransformerClick, onBuildingHover,
    onTransformerHover, onMvLineHover, onMapClick,
  }, sketchRef);

  // 4. OL layer hiding & z-index management
  useOlLayerSync(olMap, visible);

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
      <MapLibre3DControls mapRef={mapRef} placement={controlsPlacement} footprintOnly={footprintOnly} />
    </>
  );
};
