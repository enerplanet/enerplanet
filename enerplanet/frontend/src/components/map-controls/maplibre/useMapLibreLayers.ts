import { useEffect, useCallback, useRef, useMemo } from 'react';
import type * as maplibregl from 'maplibre-gl';
import {
  buildClusterColorMap,
  addOrUpdateBuildings,
  addOrUpdateLvLines,
  addOrUpdateMvLines,
  addOrUpdateTransformers,
  addOrUpdateConnections,
  addOrUpdateRegionBoundaries,
  addOrUpdatePolygon,
  setupBoundaryInteractions,
  addOrUpdateUserModels,
  setupUserModelInteractions,
} from './maplibre-layers';
import { reprojectGeoJSON } from './maplibre-utils';
import { LOD2_LAYER_ID, Lod2Layer } from './maplibre-lod2';
import { useLod2Surfaces } from './useLod2Surfaces';
import { usePvSurfaceIds, type TechsFor } from './usePvSurfaceIds';

export interface LayerData {
  buildingsGeoJSON?: any;
  linesGeoJSON?: any;
  mvLinesGeoJSON?: any;
  transformersGeoJSON?: any;
  connectionGeoJSON?: GeoJSON.FeatureCollection | null;
  availableBoundaryGeoJSON?: any;
  selectedBoundaryFeature?: any;
  showBoundary?: boolean;
  polygonCoordinates?: [number, number][][];
  selectedBuildingOsmIds?: string[];
  isBuildingAssignMode?: boolean;
  onBoundaryRegionClick?: (regionName: string) => void;
  userModelGeoJSON?: any;
  onUserModelClick?: (modelId: number, status?: string) => void;
  techsFor?: TechsFor;
}

/**
 * Hook: Load and update all data layers on the MapLibre map.
 * Optimized for 3D performance by memoizing reprojections and throttling updates.
 */
export function useMapLibreLayers(
  mapRef: React.RefObject<maplibregl.Map | null>,
  data: LayerData,
  /** True once mapRef holds the map, so data present before it is drawn too. */
  mapReady: boolean,
) {
  const {
    buildingsGeoJSON,
    linesGeoJSON,
    mvLinesGeoJSON,
    transformersGeoJSON,
    connectionGeoJSON,
    availableBoundaryGeoJSON,
    selectedBoundaryFeature,
    showBoundary = true,
    polygonCoordinates,
    selectedBuildingOsmIds = [],
    isBuildingAssignMode = false,
    onBoundaryRegionClick,
    userModelGeoJSON,
    onUserModelClick,
    techsFor,
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
  const connections = useMemo(() => reprojectGeoJSON(connectionGeoJSON), [connectionGeoJSON]);
  const userModels = useMemo(() => reprojectGeoJSON(userModelGeoJSON), [userModelGeoJSON]);

  const { surfaces: lod2, loading: lod2Loading, country } = useLod2Surfaces(buildings, mapReady);
  const pvSurfaceIds = usePvSurfaceIds(buildings, techsFor, country);
  const lod2LayerRef = useRef<Lod2Layer | null>(null);

  const loadAll = useCallback((map: maplibregl.Map) => {
    if (!map.isStyleLoaded()) return;

    // Use pre-reprojected data
    const colorMap = buildClusterColorMap(buildings, lines, transformers);

    addOrUpdateBuildings(map, buildings, colorMap, selectedBuildingOsmIds);
    addOrUpdateLvLines(map, lines, colorMap);
    addOrUpdateMvLines(map, mvLines);
    addOrUpdateTransformers(map, transformers, colorMap);
    addOrUpdateConnections(map, connections);
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
    connections,
    userModels,
    availableBoundaryGeoJSON,
    selectedBoundaryFeature,
    showBoundary,
    polygonCoordinates,
    selectedBuildingOsmIds,
  ]);

  // Combined effect for initial load and data updates
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // isStyleLoaded is false while any source is still loading, and 'load' fires
    // only once per map, so a late call waits for the map to settle instead.
    if (map.isStyleLoaded()) {
      loadAll(map);
    } else {
      map.once('idle', () => loadAll(map));
    }
  }, [mapRef, mapReady, loadAll]);

  // A recreated map has no LoD2 layer yet, so one is added to each new map.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      if (!lod2LayerRef.current || !map.getLayer(LOD2_LAYER_ID)) {
        lod2LayerRef.current = new Lod2Layer();
        map.addLayer(lod2LayerRef.current);
      }
      lod2LayerRef.current.setBuildings(lod2, pvSurfaceIds);
    };
    if (map.isStyleLoaded()) apply();
    else map.once('idle', apply);
  }, [mapRef, mapReady, lod2, pvSurfaceIds]);

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
  }, [mapRef, mapReady, availableBoundaryGeoJSON, userModelGeoJSON]);

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
  }, [mapRef, mapReady, buildingsGeoJSON]);

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
  }, [mapRef, mapReady, isBuildingAssignMode, selectedBuildingOsmIds]);

  // Buildings left as flat footprints once the LoD2 lookup has finished.
  const footprintOnly = lod2Loading ? 0 : Math.max(0, (buildings?.features.length ?? 0) - lod2.size);

  return { loadAll, footprintOnly };
}
