import React from 'react';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Map as OlMap } from 'ol';
import { useMapLibreMap } from './useMapLibreMap';
import { useMapLibreLayers, type LayerData } from './useMapLibreLayers';
import { useMapLibreInteractions, type InteractionCallbacks } from './useMapLibreInteractions';
import { useOlLayerSync } from './useOlLayerSync';
import { useAreaSketch3D, type AreaSketch3DCallbacks } from './useAreaSketch3D';
import { MapLibre3DControls } from './MapLibre3DControls';
import type { MapControlsPlacement } from '@/components/map-controls/MapControls';
import { Credits } from '@/features/configurator/building-config/Credits';

interface MapLibre3DOverlayProps extends LayerData, InteractionCallbacks {
  olMap: OlMap;
  visible: boolean;
  /** Drawing and editing of areas on the ground; polygon indexes follow polygonCoordinates. */
  areaSketch?: AreaSketch3DCallbacks;
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
  areaSketch = {},
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
  disabledBuildingOsmIds,
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
  onBuildingPick,
}) => {
  // 1. Map lifecycle & OL sync
  const { containerRef, mapRef, mapReady } = useMapLibreMap(olMap, visible);

  // 2. Data layers
  const { footprintOnly, lod2LayerRef, credits } = useMapLibreLayers(mapRef, {
    buildingsGeoJSON, linesGeoJSON, mvLinesGeoJSON,
    transformersGeoJSON, availableBoundaryGeoJSON, showBoundary, polygonCoordinates,
    selectedBuildingOsmIds, disabledBuildingOsmIds, isBuildingAssignMode, onBoundaryRegionClick, userModelGeoJSON, onUserModelClick, techsFor,
  }, mapReady);

  // 3. Click/hover interactions (forwarded from OL events to MapLibre queryRenderedFeatures)
  const sketchRef = useAreaSketch3D(mapRef, mapReady, olMap, cancelSketchTrigger, polygonCoordinates, areaSketch);
  useMapLibreInteractions(mapRef, lod2LayerRef, olMap, visible, {
    onBuildingClick, onTransformerClick, onBuildingHover,
    onTransformerHover, onMvLineHover, onMapClick, onBuildingPick,
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
      {credits.length > 0 && (
        <div className="bg-card/80 text-muted-foreground absolute bottom-3 left-24 z-50 max-w-xl rounded px-2 py-1 text-[11px] backdrop-blur-sm">
          <Credits credits={credits} />
        </div>
      )}
    </>
  );
};

