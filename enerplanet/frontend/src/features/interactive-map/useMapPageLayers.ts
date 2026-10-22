import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useAvailableRegions } from '@/features/configurator/hooks/useAvailableRegions';
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
  const [models, setModels] = useState<{ fc: GeoJSON.FeatureCollection | null; count: number }>();
  const fetchedRef = useRef(false);

  // Regions come from the shared query, which retries a failed load; the
  // user's model polygons are fetched once.
  const { data: regionsResponse } = useAvailableRegions();
  const regions = useMemo(() => {
    const response = regionsResponse;
    if (!response?.regions?.length) return undefined;

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
  }, [regionsResponse]);

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
    void fetchUserModels().then(setModels);
  }, [fetchUserModels]);

  return useMemo(() => ({
    availableBoundaryGeoJSON: regions?.fc ?? undefined,
    userModelGeoJSON: models?.fc ?? undefined,
    regionCount: regions?.count ?? 0,
    modelCount: models?.count ?? 0,
  }), [regions, models]);
}
