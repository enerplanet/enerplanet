/**
 * Hook for rendering model results on the shared map
 * Uses the global map from useMapStore and shared gridLayerUtils
 */
import { useEffect, useRef, useState } from 'react';
import { useMapStore } from '@/features/interactive-map/store/map-store';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import Feature from 'ol/Feature';
import Point from 'ol/geom/Point';
import Polygon from 'ol/geom/Polygon';
import type { Geometry } from 'ol/geom';
import { fromLonLat, toLonLat } from 'ol/proj';
import { Style, Fill, Stroke, Circle as CircleStyle, Text } from 'ol/style';
import { getCenter } from 'ol/extent';
import {
  createBuildingStyleFunction,
  createBuildingHighlightStyleFunction,
} from '@/features/interactive-map/utils/mapStyleUtils';
import { loadGridLayers, removeGridLayers, fitToFeatures } from '@/features/configurator/utils/gridLayerUtils';
import { getFeatureFClasses, getPrimaryFClass } from '@/features/configurator/utils/fClassUtils';
import { ModelInfo, ModelResults } from '@/features/model-results/types';
import { BuildingResultData, BusStatusData } from '@/features/model-results/components/map/ResultsMapTypes';

export interface MapTooltipData {
  x: number;
  y: number;
  type: 'transformer' | 'building';
  name?: string;
  powerKva?: number;
  gridResultId?: number;
  connectedBuildings?: number;
  connectedBuildingTypes?: string[];
  // Building specific
  buildingType?: string;
  fClass?: string;
  fClasses?: string[];
  area?: number;
  yearlyDemandKwh?: number;
  techs?: Record<string, unknown>;
}

// Helper to count buildings connected to a transformer
const countConnectedBuildingsFromSource = (
  source: VectorSource | null,
  transformerId: number | null
): { count: number; types: string[] } => {
  if (!source || transformerId === null) return { count: 0, types: [] };

  let count = 0;
  const types: string[] = [];

  for (const f of source.getFeatures()) {
    const bGridResultId = f.get('grid_result_id') ?? f.get('transformer_id');
    if (bGridResultId === undefined || bGridResultId === null) continue;

    const bNumId = typeof bGridResultId === 'number' ? bGridResultId : Number.parseInt(String(bGridResultId), 10);
    if (bNumId === transformerId) {
      count++;
      const fClasses = getFeatureFClasses(f.getProperties() as Record<string, unknown>);
      for (const fClass of fClasses) {
        if (!types.includes(fClass)) {
          types.push(fClass);
        }
      }
    }
  }

  return { count, types };
};

// Helper to find closest matching location from coordinates
interface CoordinateMatch {
  locationId: string | undefined;
  techs: { tech: string; capacity: number }[];
  totalDemand: number;
  totalProduction: number;
}

const toFiniteNumber = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const parsed = Number(trimmed.replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
};

const isDemandTech = (tech: string): boolean => {
  const base = tech.split(':', 2)[0].toLowerCase();
  return base.endsWith('_demand');
};

// Helper to find closest location by coordinates
const findClosestLocation = (
  lonLat: number[],
  coordinates: Record<string, { x: number; y: number }>
): string | undefined => {
  let matchedLocationId: string | undefined;
  let minDist = Infinity;

  for (const [locId, coord] of Object.entries(coordinates)) {
    if (locId.toLowerCase().includes('trafo')) continue;
    const dist = Math.hypot(lonLat[0] - coord.x, lonLat[1] - coord.y);
    if (dist < minDist && dist < 0.001) {
      minDist = dist;
      matchedLocationId = locId;
    }
  }
  return matchedLocationId;
};

// Helper to collect tech data for a location
const collectTechData = (
  locationId: string | undefined,
  energyCap: Array<{ location: string; tech: string; value: number }> | undefined
): { techs: { tech: string; capacity: number }[]; totalDemand: number; totalProduction: number } => {
  const techs: { tech: string; capacity: number }[] = [];
  let totalDemand = 0, totalProduction = 0;

  if (locationId && energyCap) {
    for (const cap of energyCap) {
      if (cap.location !== locationId) continue;
      const absValue = Math.abs(cap.value);
      techs.push({ tech: cap.tech, capacity: absValue });
      if (isDemandTech(cap.tech)) totalDemand += absValue;
      else totalProduction += absValue;
    }
  }
  return { techs, totalDemand, totalProduction };
};

const inferPowerScaleFromYearlyDemand = (
  yearlyDemandKwh: number | undefined,
  totalDemandKw: number,
  totalProductionKw: number
): number => {
  if (!yearlyDemandKwh || yearlyDemandKwh <= 0) return 1;
  const expectedAvgKw = yearlyDemandKwh / 8760;
  if (!Number.isFinite(expectedAvgKw) || expectedAvgKw <= 0) return 1;

  const observedMagnitude = Math.max(Math.abs(totalDemandKw), Math.abs(totalProductionKw));
  if (!Number.isFinite(observedMagnitude) || observedMagnitude <= 0) return 1;

  const ratio = observedMagnitude / expectedAvgKw;
  // Common mismatch: backend values in W but UI assumes kW.
  if (ratio > 80 && ratio < 5000) return 0.001;
  // Defensive inverse case.
  if (ratio > 0 && ratio < 0.01) return 1000;
  return 1;
};

const scaleCoordinateMatch = (match: CoordinateMatch, scale: number): CoordinateMatch => ({
  ...match,
  techs: match.techs.map((tech) => ({ ...tech, capacity: tech.capacity * scale })),
  totalDemand: match.totalDemand * scale,
  totalProduction: match.totalProduction * scale,
});

const findMatchingLocation = (
  lonLat: number[],
  coordinates: Record<string, { x: number; y: number }>,
  energyCap: Array<{ location: string; tech: string; value: number }> | undefined
): CoordinateMatch => {
  const locationId = findClosestLocation(lonLat, coordinates);
  const { techs, totalDemand, totalProduction } = collectTechData(locationId, energyCap);
  return { locationId, techs, totalDemand, totalProduction };
};

// Helper to parse grid result ID from feature
const parseGridResultId = (feature: any): number | null => {
  const gridResultId = feature.get('grid_result_id');
  if (gridResultId === undefined || gridResultId === null) return null;
  if (typeof gridResultId === 'number') return gridResultId;
  return Number.parseInt(String(gridResultId), 10);
};

// Helper to create transformer tooltip data
const createTransformerTooltip = (
  pixel: number[],
  props: any,
  numId: number | null,
  connectedCount: number,
  buildingTypes: string[]
): MapTooltipData => ({
  x: pixel[0],
  y: pixel[1],
  type: 'transformer',
  name: props.name || `Transformer ${numId}`,
  powerKva: props.power_kva || props.rated_power_kva,
  gridResultId: numId ?? undefined,
  connectedBuildings: connectedCount,
  connectedBuildingTypes: buildingTypes,
});

// Helper to create building tooltip data
const createBuildingTooltip = (pixel: number[], props: any): MapTooltipData => {
  const fClasses = getFeatureFClasses(props);
  const primary = getPrimaryFClass(props) || 'unknown';
  return {
    x: pixel[0],
    y: pixel[1],
    type: 'building',
    name: props.osm_id || props.id,
    buildingType: primary,
    fClass: primary,
    fClasses,
    area: props.area,
    yearlyDemandKwh: props.yearly_demand_kwh || props.demand_energy,
    techs: props.techs,
  };
};

interface UseModelResultsMapOptions {
  model: ModelInfo | null;
  results: ModelResults | null;
  onBuildingSelect: (building: BuildingResultData | null) => void;
  onTransformerHover?: (connectedBuildings: string[] | null) => void;
  onTooltipChange?: (tooltip: MapTooltipData | null) => void;
  busStatusData?: BusStatusData[];
  showBusMarkers?: boolean;
  highlightedBuildings?: string[] | null;
}

export const useModelResultsMap = ({
  model,
  results,
  onBuildingSelect,
  onTransformerHover,
  onTooltipChange,
  busStatusData,
  showBusMarkers = false,
  highlightedBuildings,
}: UseModelResultsMapOptions) => {
  const { map } = useMapStore();
  const layersRef = useRef<VectorLayer<VectorSource>[]>([]);
  const polygonLayerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const buildingSourceRef = useRef<VectorSource | null>(null);
  const busLayerRef = useRef<VectorLayer<VectorSource> | null>(null);

  // Use state for hovered transformer (like AreaSelect) to prevent blinking
  const [hoveredTransformerId, setHoveredTransformerId] = useState<number | null>(null);
  const highlightedBuildingsRef = useRef<Feature<Geometry>[]>([]);

  // Refs for callbacks
  const onBuildingSelectRef = useRef(onBuildingSelect);
  onBuildingSelectRef.current = onBuildingSelect;
  const onTransformerHoverRef = useRef(onTransformerHover);
  onTransformerHoverRef.current = onTransformerHover;
  const onTooltipChangeRef = useRef(onTooltipChange);
  onTooltipChangeRef.current = onTooltipChange;

  // Load model layers onto shared map
  useEffect(() => {
    if (!map || !model?.config) return;

    removeGridLayers(map, layersRef.current);
    layersRef.current = [];
    if (polygonLayerRef.current) {
      map.removeLayer(polygonLayerRef.current);
      polygonLayerRef.current = null;
    }

    const allFeatures: Feature<Geometry>[] = [];

    // Add polygon layer (model boundary)
    if (model.coordinates?.coordinates && model.coordinates.coordinates.length > 0) {
      const polygonSource = new VectorSource();
      model.coordinates.coordinates.forEach((polygonCoords: any) => {
        if (polygonCoords.length > 0 && polygonCoords[0].length > 0) {
          const projectedCoords = polygonCoords[0].map((coord: [number, number]) =>
            fromLonLat([coord[0], coord[1]])
          );
          const feature = new Feature({ geometry: new Polygon([projectedCoords]) });
          feature.setStyle(new Style({
            fill: new Fill({ color: 'rgba(59, 130, 246, 0.15)' }),
            stroke: new Stroke({ color: '#3b82f6', width: 2, lineDash: [8, 4] }),
          }));
          polygonSource.addFeature(feature);
          allFeatures.push(feature);
        }
      });
      const polygonLayer = new VectorLayer({ source: polygonSource, zIndex: 1 });
      map.addLayer(polygonLayer);
      polygonLayerRef.current = polygonLayer;
    }

    // Load grid layers using shared utility
    const { layers, buildingSource, allFeatures: gridFeatures } = loadGridLayers(map, model.config, { enable3D: false });
    layersRef.current = layers;
    buildingSourceRef.current = buildingSource;
    allFeatures.push(...gridFeatures);

    // Fit view with delay to ensure layers are rendered
    if (allFeatures.length > 0) {
      // Initial fit after a short delay to let layers initialize
      const initialFitTimeout = setTimeout(() => {
        fitToFeatures(map, allFeatures, { duration: 800, padding: [50, 50, 50, 50] });
      }, 300);

      // Second fit after layers are fully rendered
      const finalFitTimeout = setTimeout(() => {
        fitToFeatures(map, allFeatures, { duration: 500, padding: [50, 50, 50, 50] });
      }, 800);

      return () => {
        clearTimeout(initialFitTimeout);
        clearTimeout(finalFitTimeout);
        removeGridLayers(map, layersRef.current);
        layersRef.current = [];
        if (polygonLayerRef.current) {
          map.removeLayer(polygonLayerRef.current);
          polygonLayerRef.current = null;
        }
        buildingSourceRef.current = null;
      };
    }

    return () => {
      removeGridLayers(map, layersRef.current);
      layersRef.current = [];
      if (polygonLayerRef.current) {
        map.removeLayer(polygonLayerRef.current);
        polygonLayerRef.current = null;
      }
      buildingSourceRef.current = null;
    };
  }, [map, model]);

  // Highlight buildings connected to hovered transformer (separate effect like AreaSelect)
  useEffect(() => {
    const buildingSource = buildingSourceRef.current;
    if (!buildingSource) return;

    // Reset previously highlighted buildings
    highlightedBuildingsRef.current.forEach(feature => {
      feature.setStyle(createBuildingStyleFunction(true, false));
    });
    highlightedBuildingsRef.current = [];

    if (hoveredTransformerId === null) {
      onTransformerHoverRef.current?.(null);
      return;
    }

    // Highlight buildings with matching grid_result_id
    const connectedBuildingIds: string[] = [];
    buildingSource.getFeatures().forEach(feature => {
      const gridResultId = feature.get('grid_result_id') ?? feature.get('transformer_id');
      if (gridResultId !== undefined && gridResultId !== null) {
        const numId = typeof gridResultId === 'number' ? gridResultId : Number.parseInt(String(gridResultId), 10);
        if (numId === hoveredTransformerId) {
          feature.setStyle(createBuildingHighlightStyleFunction());
          highlightedBuildingsRef.current.push(feature);
          const osmId = feature.get('osm_id');
          if (osmId) connectedBuildingIds.push(String(osmId));
        }
      }
    });

    onTransformerHoverRef.current?.(connectedBuildingIds.length > 0 ? connectedBuildingIds : null);
  }, [hoveredTransformerId]);

  // Add bus markers layer
  useEffect(() => {
    if (!map) return;

    if (busLayerRef.current) {
      map.removeLayer(busLayerRef.current);
      busLayerRef.current = null;
    }

    if (!showBusMarkers || !busStatusData?.length || !results?.coordinates) return;

    const busSource = new VectorSource();
    busStatusData.forEach(bus => {
      const coord = results.coordinates[bus.location];
      if (!coord) return;

      const feature = new Feature({
        geometry: new Point(fromLonLat([coord.x, coord.y])),
      });
      feature.set('busData', bus);
      feature.set('featureType', 'bus');

      const color = (() => {
        if (bus.status === 'critical') return '#ef4444';
        if (bus.status === 'warning') return '#f59e0b';
        return '#22c55e';
      })();
      const isHighlighted = highlightedBuildings?.includes(bus.location);

      feature.setStyle(new Style({
        image: new CircleStyle({
          radius: isHighlighted ? 18 : 12,
          fill: new Fill({ color: isHighlighted ? '#3b82f6' : color }),
          stroke: new Stroke({ color: '#ffffff', width: isHighlighted ? 4 : 3 }),
        }),
        text: new Text({
          text: bus.avgVoltage.toFixed(2),
          font: isHighlighted ? 'bold 12px sans-serif' : 'bold 10px sans-serif',
          fill: new Fill({ color: '#ffffff' }),
          offsetY: 1,
        }),
        zIndex: isHighlighted ? 1000 : 100,
      }));
      busSource.addFeature(feature);
    });

    busLayerRef.current = new VectorLayer({ source: busSource, zIndex: 200 });
    map.addLayer(busLayerRef.current);

    return () => {
      if (busLayerRef.current) {
        map.removeLayer(busLayerRef.current);
        busLayerRef.current = null;
      }
    };
  }, [map, showBusMarkers, busStatusData, results?.coordinates, highlightedBuildings]);

  // Click and hover handlers
  useEffect(() => {
    if (!map) return;

    const handleClick = (evt: any) => {
      let clickedFeature: Feature<Geometry> | null = null;

      map.forEachFeatureAtPixel(evt.pixel, (f) => {
        const featureType = f.get('feature_type');
        if (featureType === 'building' || featureType === 'transformer') {
          clickedFeature = f as Feature<Geometry>;
          return true;
        }
        return false;
      }, { hitTolerance: 5 });

      if (!clickedFeature) {
        onBuildingSelectRef.current(null);
        return;
      }

      const featureType = (clickedFeature as any).get('feature_type');
      const props = (clickedFeature as any).getProperties();

      if (featureType === 'building') {
        const fClasses = getFeatureFClasses(props);
        const primaryFClass = getPrimaryFClass(props) || 'unknown';
        let match: CoordinateMatch = { locationId: undefined, techs: [], totalDemand: 0, totalProduction: 0 };
        const yearlyDemandKwh = toFiniteNumber(props.yearly_demand_kwh ?? props.demand_energy);
        const peakLoadKw = toFiniteNumber(props.peak_load_kw ?? props.peak_load);

        if (results?.coordinates) {
          const geom = (clickedFeature as any).getGeometry();
          if (geom) {
            const center = getCenter(geom.getExtent());
            const lonLat = toLonLat(center);
            match = findMatchingLocation(lonLat, results.coordinates, results.energy_cap);
          }
        }

        const scale = inferPowerScaleFromYearlyDemand(
          yearlyDemandKwh,
          match.totalDemand,
          match.totalProduction
        );
        if (scale !== 1) {
          match = scaleCoordinateMatch(match, scale);
        }

        onBuildingSelectRef.current({
          buildingId: props.osm_id || props.id || 'Building',
          address: props.addr_stree || props.address,
          technologies: match.techs,
          totalDemand: match.totalDemand,
          totalProduction: match.totalProduction,
          matchedLocationId: match.locationId,
          fClass: primaryFClass,
          fClasses,
          area: props.area,
          height: props.height,
          levels: props.levels,
          roofArea: props.roof_area,
          yearBuilt: props.year_built ?? props.yearbuilt,
          osmId: props.osm_id,
          techConfig: props.techs,
          // Energy demand
          yearlyDemandKwh,
          peakLoadKw,
          // Building enrichment (3D BAG for NL, EUBUCCO for DE/AT/others)
          bagId: props.bag_id,
          constructionYear: props.construction_year ?? props.constructi ?? props.Constructi ?? props.oorspronkelijk_bouwjaar ?? props.oorspronkelijkbouwjaar,
          floors3dbag: props.floors_3dbag,
          heightMax: props.height_max,
          heightMedian: props.height_median,
          heightGround: props.height_ground,
          // EP-Online enrichment
          energyLabel: props.energy_label,
          energyIndex: props.energy_index,
          // CBS enrichment
          cbsPopulation: props.cbs_population,
          cbsHouseholds: props.cbs_households,
          cbsAvgHouseholdSize: props.cbs_avg_household_size,
        });
      } else if (featureType === 'transformer') {
        onBuildingSelectRef.current({
          buildingId: String(props.name || props.id || props.osm_id || 'Transformer'),
          address: 'Distribution Transformer',
          technologies: [],
          totalDemand: 0,
          totalProduction: props.power_kva || 0,
          fClass: 'Transformer',
          area: props.power_kva,
        });
      }
    };

    const handlePointerMove = (evt: any) => {
      if (evt.dragging) return;
      const target = map.getTarget() as HTMLElement;
      const pixel = evt.pixel;
      const buildingSource = buildingSourceRef.current;

      const feature = map.forEachFeatureAtPixel(pixel, (f) => {
        const featureType = f.get('feature_type');
        if (featureType === 'building' || featureType === 'transformer' || f.get('featureType') === 'bus') {
          return f;
        }
        return null;
      }, { hitTolerance: 10 });

      if (!feature) {
        target.style.cursor = '';
        setHoveredTransformerId(null);
        onTooltipChangeRef.current?.(null);
        return;
      }

      target.style.cursor = 'pointer';
      const featureType = feature.get('feature_type');
      const props = feature.getProperties();

      if (featureType === 'transformer') {
        const numId = parseGridResultId(feature);
        setHoveredTransformerId(numId);
        const { count, types } = countConnectedBuildingsFromSource(buildingSource, numId);
        onTooltipChangeRef.current?.(createTransformerTooltip(pixel, props, numId, count, types));
      } else if (feature.get('featureType') === 'bus') {
        const busData = feature.get('busData');
        if (busData?.location) {
          const match = busData.location.match(/\d+/);
          const numId = match ? Number.parseInt(match[0], 10) : null;
          setHoveredTransformerId(numId);
          const { count, types } = countConnectedBuildingsFromSource(buildingSource, numId);
          onTooltipChangeRef.current?.({
            ...createTransformerTooltip(pixel, { name: busData.location }, numId, count, types),
            powerKva: busData.avgPower ? Math.abs(busData.avgPower) : undefined,
          });
        }
      } else if (featureType === 'building') {
        setHoveredTransformerId(null);
        onTooltipChangeRef.current?.(createBuildingTooltip(pixel, props));
      } else {
        setHoveredTransformerId(null);
        onTooltipChangeRef.current?.(null);
      }
    };

    let throttleTimeout: any = null;
    const throttledPointerMove = (evt: any) => {
      if (throttleTimeout) return;

      handlePointerMove(evt);

      throttleTimeout = setTimeout(() => {
        throttleTimeout = null;
      }, 32);
    };

    map.on('click', handleClick);
    map.on('pointermove', throttledPointerMove);

    return () => {
      if (throttleTimeout) clearTimeout(throttleTimeout);
      map.un('click', handleClick);
      map.un('pointermove', throttledPointerMove);
    };
  }, [map, results]);

  useEffect(() => {
    const buildingSource = buildingSourceRef.current;
    if (!buildingSource) return;

    // Don't reset if we're currently hovering a transformer
    if (hoveredTransformerId !== null) return;

    buildingSource.getFeatures().forEach(f => f.setStyle(createBuildingStyleFunction(true, false)));

    if (!highlightedBuildings?.length) return;

    const featureMap = new Map<string, Feature<Geometry>>();
    buildingSource.getFeatures().forEach(f => {
      const osmId = String(f.get('osm_id') || '');
      if (osmId) featureMap.set(osmId, f as Feature<Geometry>);
      const locId = String(f.get('location_id') || '');
      if (locId) featureMap.set(locId, f as Feature<Geometry>);
    });

    highlightedBuildings.forEach(id => {
      const feature = featureMap.get(id) || featureMap.get(`ID_${id}`) || featureMap.get(id.replace('ID_', ''));
      if (feature) {
        (feature as any).setStyle(createBuildingHighlightStyleFunction());
      }
    });
  }, [highlightedBuildings, hoveredTransformerId]);

  return { buildingSourceRef };
};
