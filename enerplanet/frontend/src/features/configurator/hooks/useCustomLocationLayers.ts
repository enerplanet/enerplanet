import { useEffect, useRef } from "react";
import type { Map as OLMap } from "ol";
import VectorSource from "ol/source/Vector";
import VectorLayer from "ol/layer/Vector";
import { Polygon } from "ol/geom";
import { Feature as OLFeature } from "ol";
import { Style, Fill, Stroke } from "ol/style";
import { fromLonLat } from "ol/proj";
import { customLocationService, type CustomLocation } from "@/features/locations/services/customLocationService";
import { useModelStore } from "@/features/configurator/store/modelStore";

const checkBboxIntersection = (
  polygon: [number, number][],
  locCoords: [number, number][]
): boolean => {
  const drawnMinLon = Math.min(...polygon.map(c => c[0]));
  const drawnMaxLon = Math.max(...polygon.map(c => c[0]));
  const drawnMinLat = Math.min(...polygon.map(c => c[1]));
  const drawnMaxLat = Math.max(...polygon.map(c => c[1]));
  const locMinLon = Math.min(...locCoords.map(c => c[0]));
  const locMaxLon = Math.max(...locCoords.map(c => c[0]));
  const locMinLat = Math.min(...locCoords.map(c => c[1]));
  const locMaxLat = Math.max(...locCoords.map(c => c[1]));
  return drawnMaxLon >= locMinLon && drawnMinLon <= locMaxLon &&
    drawnMaxLat >= locMinLat && drawnMinLat <= locMaxLat;
};

const locationIntersectsPolygons = (
  location: CustomLocation,
  polygons: [number, number][][]
): boolean => {
  if (!location.geometry_area?.coordinates) return false;
  const locCoords = location.geometry_area.coordinates[0] as [number, number][];
  return polygons.some(polygon => checkBboxIntersection(polygon, locCoords));
};

export const useCustomLocationLayers = (map: OLMap | null, allPolygons: [number, number][][]) => {
  const customLocations = useModelStore((s) => s.customLocations);
  const setCustomLocations = useModelStore((s) => s.setCustomLocations);
  const customLocationsInPolygon = useModelStore((s) => s.customLocationsInPolygon);
  const setCustomLocationsInPolygon = useModelStore((s) => s.setCustomLocationsInPolygon);
  const customLocationLayerRef = useRef<VectorLayer<VectorSource> | null>(null);

  // Load custom locations on mount
  useEffect(() => {
    const loadCustomLocations = async () => {
      try {
        const [userResponse, publicResponse] = await Promise.all([
          customLocationService.getUserLocations({ per_page: 100 }),
          customLocationService.getPublicLocations({ per_page: 100 }),
        ]);
        const userLocationIds = new Set(userResponse.data.map(l => l.id));
        const uniquePublic = publicResponse.data.filter(loc => !userLocationIds.has(loc.id));
        setCustomLocations([...userResponse.data, ...uniquePublic]);
      } catch (error) {
        console.error('Failed to load custom locations:', error);
      }
    };
    loadCustomLocations();
  }, [setCustomLocations]);

  // Filter locations intersecting the current polygon
  useEffect(() => {
    if (allPolygons.length === 0 || customLocations.length === 0) {
      setCustomLocationsInPolygon([]);
      return;
    }
    const intersectingLocations = customLocations.filter(
      loc => locationIntersectsPolygons(loc, allPolygons)
    );
    setCustomLocationsInPolygon(intersectingLocations);
  }, [allPolygons, customLocations, setCustomLocationsInPolygon]);

  // Render location layers on map
  useEffect(() => {
    if (!map || customLocations.length === 0) return;

    if (customLocationLayerRef.current) {
      map.removeLayer(customLocationLayerRef.current);
      customLocationLayerRef.current = null;
    }

    const source = new VectorSource();
    customLocations.forEach(location => {
      if (location.geometry_area?.coordinates) {
        const coords = location.geometry_area.coordinates[0] as [number, number][];
        const mapCoords = coords.map(([lon, lat]) => fromLonLat([lon, lat]));
        if (mapCoords.length > 0) mapCoords.push(mapCoords[0]);
        const polygon = new Polygon([mapCoords]);
        const feature = new OLFeature({ geometry: polygon });
        feature.set('custom_location_id', location.id);
        feature.set('custom_location', location);
        feature.setStyle(new Style({
          fill: new Fill({ color: 'rgba(147, 51, 234, 0.15)' }),
          stroke: new Stroke({ color: '#9333ea', width: 2, lineDash: [6, 4] }),
        }));
        source.addFeature(feature);
      }
    });

    const layer = new VectorLayer({ source, zIndex: 50 });
    map.addLayer(layer);
    customLocationLayerRef.current = layer;

    return () => {
      if (customLocationLayerRef.current) {
        map.removeLayer(customLocationLayerRef.current);
        customLocationLayerRef.current = null;
      }
    };
  }, [map, customLocations]);

  return { customLocations, customLocationsInPolygon, setCustomLocationsInPolygon };
};
