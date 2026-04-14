import { useState, useEffect, useCallback, useRef } from 'react';
import { pylovoService } from '@/features/configurator/services/pylovoService';
import { modelService } from '@/features/model-dashboard/services/modelService';
import { reprojectGeoJSON } from '@/components/map-controls/maplibre/maplibre-utils';

interface MapPageLayerData {
  availableBoundaryGeoJSON?: GeoJSON.FeatureCollection;
  userModelGeoJSON?: GeoJSON.FeatureCollection;
  regionCount: number;
  modelCount: number;
}

/**
 * Hook: Fetches available region boundaries (public) and the current user's
 * model polygons (private) for display on the /map page.
 */
export function useMapPageLayers(isAuthenticated: boolean): MapPageLayerData {
  const [data, setData] = useState<MapPageLayerData>({
    regionCount: 0,
    modelCount: 0,
  });
  const fetchedRef = useRef(false);

  const fetchRegions = useCallback(async () => {
    try {
      const response = await pylovoService.getAvailableRegions();
      if (response.status !== 'success' || !response.regions?.length) return undefined;

      const features = response.regions
        .filter(r => r.boundary && r.region?.name)
        .map(r => ({
          ...r.boundary!,
          properties: {
            ...(r.boundary!.properties ?? {}),
            name: r.region!.name,
            grid_count: r.grid_count,
            _boundary_role: 'available',
          },
        }));

      if (features.length === 0) return undefined;

      const fc: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features };
      return { fc: reprojectGeoJSON(fc), count: response.regions.length };
    } catch {
      return undefined;
    }
  }, []);

  const fetchUserModels = useCallback(async () => {
    if (!isAuthenticated) return undefined;
    try {
      const response = await modelService.getModels({ limit: 100 });
      if (!response.success || !response.data?.length) return undefined;

      const features: GeoJSON.Feature[] = [];
      for (const model of response.data) {
        if (!model.coordinates) continue;
        const coords = model.coordinates as { type?: string; coordinates?: unknown };
        if (!coords.type || !coords.coordinates) continue;

        features.push({
          type: 'Feature',
          properties: {
            model_id: model.id,
            title: model.title,
            status: model.status,
            region: model.region,
            country: model.country,
          },
          geometry: coords as GeoJSON.Geometry,
        });
      }

      if (features.length === 0) return undefined;

      const fc: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features };
      return { fc: reprojectGeoJSON(fc), count: response.data.length };
    } catch {
      return undefined;
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;

    (async () => {
      const [regions, models] = await Promise.all([fetchRegions(), fetchUserModels()]);
      setData({
        availableBoundaryGeoJSON: regions?.fc ?? undefined,
        userModelGeoJSON: models?.fc ?? undefined,
        regionCount: regions?.count ?? 0,
        modelCount: models?.count ?? 0,
      });
    })();
  }, [fetchRegions, fetchUserModels]);

  return data;
}
