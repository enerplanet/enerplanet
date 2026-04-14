import { useCallback, useEffect } from 'react';
import { transformExtent } from 'ol/proj';
import type OLMap from 'ol/Map';

/**
 * Format area value with appropriate units (m² or km²)
 */
export const formatArea = (areaValue: number): string => {
  if (areaValue > 10000) {
    return `${(areaValue / 1000000).toFixed(2)} km²`;
  }
  return `${areaValue.toFixed(0)} m²`;
};

/**
 * Core zoom logic - fits map view to coordinates extent
 */
const zoomToCoordinatesExtent = (
  map: OLMap,
  coords: [number, number][],
  options?: { duration?: number; padding?: number; maxZoom?: number }
) => {
  const lons = coords.map(c => c[0]);
  const lats = coords.map(c => c[1]);
  const paddingValue = options?.padding ?? 0.01;
  const extent = [
    Math.min(...lons) - paddingValue,
    Math.min(...lats) - paddingValue,
    Math.max(...lons) + paddingValue,
    Math.max(...lats) + paddingValue
  ];
  const transformedExtent = transformExtent(extent, 'EPSG:4326', 'EPSG:3857');
  map.getView().fit(transformedExtent, {
    duration: options?.duration ?? 500,
    padding: [50, 50, 50, 50],
    maxZoom: options?.maxZoom,
  });
};

/**
 * Hook for zooming map to coordinates
 */
export const useZoomToCoordinates = (map: OLMap | null) => {
  return useCallback((coords: [number, number][], options?: { duration?: number; padding?: number; maxZoom?: number }) => {
    if (!map || coords.length === 0) return;
    zoomToCoordinatesExtent(map, coords, options);
  }, [map]);
};

/**
 * Hook to clear map overlays on mount
 */
export const useClearOverlays = (
  clearOverlayLayers: () => void,
  setFireRiskOverlay: (value: null) => void
) => {
  useEffect(() => {
    clearOverlayLayers();
    setFireRiskOverlay(null);
  }, [clearOverlayLayers, setFireRiskOverlay]);
};
