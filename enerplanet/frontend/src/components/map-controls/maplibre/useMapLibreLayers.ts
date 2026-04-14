import { useEffect, useCallback, useRef, useMemo } from 'react';
import type maplibregl from 'maplibre-gl';
import {
  buildClusterColorMap,
  addOrUpdateBuildings,
  addOrUpdateLvLines,
  addOrUpdateMvLines,
  addOrUpdateTransformers,
  addOrUpdateRegionBoundaries,
  addOrUpdatePolygon,
  setupBoundaryInteractions,
  addOrUpdateUserModels,
  setupUserModelInteractions,
} from './maplibre-layers';
import { reprojectGeoJSON } from './maplibre-utils';

export interface LayerData {
  buildingsGeoJSON?: any;
  linesGeoJSON?: any;
  mvLinesGeoJSON?: any;
  transformersGeoJSON?: any;
  availableBoundaryGeoJSON?: any;
  selectedBoundaryFeature?: any;
  showBoundary?: boolean;
  polygonCoordinates?: [number, number][][];
  selectedBuildingOsmIds?: string[];
  isBuildingAssignMode?: boolean;
  onBoundaryRegionClick?: (regionName: string) => void;
  userModelGeoJSON?: any;
  onUserModelClick?: (modelId: number, status?: string) => void;
}

/**
 * Hook: Load and update all data layers on the MapLibre map.
 * Optimized for 3D performance by memoizing reprojections and throttling updates.
 */
export function useMapLibreLayers(
  mapRef: React.RefObject<maplibregl.Map | null>,
  data: LayerData,
) {
  const {
    buildingsGeoJSON,
    linesGeoJSON,
    mvLinesGeoJSON,
    transformersGeoJSON,
    availableBoundaryGeoJSON,
    selectedBoundaryFeature,
    showBoundary = true,
    polygonCoordinates,
    selectedBuildingOsmIds = [],
    isBuildingAssignMode = false,
    onBoundaryRegionClick,
    userModelGeoJSON,
    onUserModelClick,
  } = data;

  const boundaryClickRef = useRef(onBoundaryRegionClick);
  boundaryClickRef.current = onBoundaryRegionClick;
  const boundaryCleanupRef = useRef<(() => void) | null>(null);

  const modelClickRef = useRef(onUserModelClick);
  modelClickRef.current = onUserModelClick;
  const modelCleanupRef = useRef<(() => void) | null>(null);

  // Granularly memoize reprojected GeoJSON to avoid redundant heavy CPU work
  const buildings = useMemo(() => reprojectGeoJSON(buildingsGeoJSON), [buildingsGeoJSON]);
  const lines = useMemo(() => reprojectGeoJSON(linesGeoJSON), [linesGeoJSON]);
  const mvLines = useMemo(() => reprojectGeoJSON(mvLinesGeoJSON), [mvLinesGeoJSON]);
  const transformers = useMemo(() => reprojectGeoJSON(transformersGeoJSON), [transformersGeoJSON]);
  const userModels = useMemo(() => reprojectGeoJSON(userModelGeoJSON), [userModelGeoJSON]);

  const loadAll = useCallback((map: maplibregl.Map) => {
    if (!map.isStyleLoaded()) return;

    // Use pre-reprojected data
    const colorMap = buildClusterColorMap(buildings, lines, transformers);

    addOrUpdateBuildings(map, buildings, colorMap, selectedBuildingOsmIds);
    addOrUpdateLvLines(map, lines, colorMap);
    addOrUpdateMvLines(map, mvLines);
    addOrUpdateTransformers(map, transformers, colorMap);
    addOrUpdateRegionBoundaries(
      map,
      availableBoundaryGeoJSON,
      selectedBoundaryFeature,
      showBoundary
    );
    addOrUpdatePolygon(map, polygonCoordinates);
    addOrUpdateUserModels(map, userModels);
  }, [
    buildings,
    lines,
    mvLines,
    transformers,
    userModels,
    availableBoundaryGeoJSON,
    selectedBoundaryFeature,
    showBoundary,
    polygonCoordinates,
    selectedBuildingOsmIds
  ]);

  // Combined effect for initial load and data updates
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (map.isStyleLoaded()) {
      loadAll(map);
    } else {
      map.once('load', () => loadAll(map));
    }
  }, [mapRef, loadAll]);

  // Interactions setup
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const setupInteractions = () => {
      // Boundaries
      if (availableBoundaryGeoJSON && map.getLayer('region-boundaries-available-fill')) {
        boundaryCleanupRef.current?.();
        boundaryCleanupRef.current = setupBoundaryInteractions(
          map,
          (name) => boundaryClickRef.current?.(name),
        );
      } else if (!availableBoundaryGeoJSON) {
        boundaryCleanupRef.current?.();
        boundaryCleanupRef.current = null;
      }

      // User Models
      if (userModelGeoJSON && map.getLayer('user-models-fill')) {
        modelCleanupRef.current?.();
        modelCleanupRef.current = setupUserModelInteractions(
          map,
          (id) => modelClickRef.current?.(id),
        );
      } else if (!userModelGeoJSON) {
        modelCleanupRef.current?.();
        modelCleanupRef.current = null;
      }
    };

    if (map.isStyleLoaded()) {
      setupInteractions();
    } else {
      map.on('idle', setupInteractions);
      return () => { map.off('idle', setupInteractions); };
    }

    return () => {
      boundaryCleanupRef.current?.();
      boundaryCleanupRef.current = null;
      modelCleanupRef.current?.();
      modelCleanupRef.current = null;
    };
  }, [mapRef, availableBoundaryGeoJSON, userModelGeoJSON]);

  // Keep separator lines subtle at high pitch to avoid perceived drift.
  // Throttled to avoid overhead during fast rotation.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    let rafId: number | null = null;
    let lastPitch = -1;

    const applySeparatorOpacity = () => {
      const pitch = map.getPitch();
      if (Math.abs(pitch - lastPitch) < 0.5) return; // Throttle small changes
      lastPitch = pitch;

      if (!map.getLayer('buildings-3d-separator')) return;
      
      let opacity = 0.62;
      if (pitch >= 65) opacity = 0;
      else if (pitch >= 58) opacity = 0.08;
      else if (pitch >= 48) opacity = 0.22;
      else if (pitch >= 38) opacity = 0.4;
      
      map.setPaintProperty('buildings-3d-separator', 'line-opacity', opacity);
    };

    const scheduleUpdate = () => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        applySeparatorOpacity();
      });
    };

    map.on('move', scheduleUpdate);
    scheduleUpdate(); // Initial call

    return () => {
      map.off('move', scheduleUpdate);
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [mapRef, buildingsGeoJSON]);

  // Pulse effect for assignment selection
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded() || !isBuildingAssignMode || selectedBuildingOsmIds.length === 0) {
      if (map && map.isStyleLoaded()) {
        // Reset static paint properties when inactive
        ['buildings-3d-assign-selected', 'buildings-3d-assign-selected-halo', 'buildings-3d-assign-selected-outline'].forEach(id => {
          if (map.getLayer(id)) {
            const prop = id.includes('extrusion') ? 'fill-extrusion-opacity' : 'line-opacity';
            map.setPaintProperty(id, prop, id.includes('halo') ? 0.92 : (id.includes('outline') ? 1 : 0.82));
          }
        });
      }
      return;
    }

    let rafId: number | null = null;
    const animate = (ts: number) => {
      const pulse = (Math.sin(ts / 240) + 1) / 2;

      if (map.getLayer('buildings-3d-assign-selected')) {
        map.setPaintProperty('buildings-3d-assign-selected', 'fill-extrusion-opacity', 0.64 + pulse * 0.30);
      }
      if (map.getLayer('buildings-3d-assign-selected-halo')) {
        map.setPaintProperty('buildings-3d-assign-selected-halo', 'line-width', 4.8 + pulse * 2.8);
        map.setPaintProperty('buildings-3d-assign-selected-halo', 'line-opacity', 0.52 + pulse * 0.42);
      }
      if (map.getLayer('buildings-3d-assign-selected-outline')) {
        map.setPaintProperty('buildings-3d-assign-selected-outline', 'line-width', 2.7 + pulse * 1.8);
      }

      rafId = requestAnimationFrame(animate);
    };
    rafId = requestAnimationFrame(animate);

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [mapRef, isBuildingAssignMode, selectedBuildingOsmIds]);

  return { loadAll };
}
