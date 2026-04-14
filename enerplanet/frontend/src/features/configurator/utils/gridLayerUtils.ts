/**
 * Shared utility for loading GeoJSON layers onto an OpenLayers map
 * Used by both AreaSelect (model configuration) and ModelResultsViewer (results display)
 */
import OLMap from 'ol/Map';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import Feature from 'ol/Feature';
import GeoJSON from 'ol/format/GeoJSON';
import type { Geometry } from 'ol/geom';
import type { StyleFunction } from 'ol/style/Style';
import type { FeatureLike } from 'ol/Feature';
import {
  createBuildingStyleFunction,
  cableStyleFunction,
  mvLineStyleFunction,
  transformerStyleFunction,
  boundaryStyleFunction,
  selectedBoundaryStyleFunction,
  searchBoundaryStyleFunction,
  boundaryLabelStyle,
} from '@/features/interactive-map/utils/mapStyleUtils';

// Create style functions that respond to resolution changes
const createCableStyleFunction = (): StyleFunction => {
  return (feature: FeatureLike): ReturnType<StyleFunction> => {
    return cableStyleFunction(feature as Feature<Geometry>);
  };
};

const createMvLineStyleFunction = (): StyleFunction => {
  return (feature: FeatureLike): ReturnType<StyleFunction> => {
    return mvLineStyleFunction(feature as Feature<Geometry>);
  };
};

const createTransformerStyleFunction = (): StyleFunction => {
  return (feature: FeatureLike, resolution: number): ReturnType<StyleFunction> => {
    return transformerStyleFunction(feature as Feature<Geometry>, resolution);
  };
};

// GeoJSON data structure for grid/model config
interface GridLayerData {
  buildings?: { features?: any[] };
  lines?: { features?: any[] };
  mv_lines?: { features?: any[] };
  transformers?: { features?: any[] };
}

interface LoadLayersResult {
  layers: VectorLayer<VectorSource>[];
  buildingSource: VectorSource | null;
  allFeatures: Feature<Geometry>[];
}

/**
 * Detect coordinate system from GeoJSON
 */
export const getDataProjection = (geojson: any): 'EPSG:4326' | 'EPSG:3857' => {
  const coords = geojson?.features?.[0]?.geometry?.coordinates;
  const firstNumber = (() => {
    if (!Array.isArray(coords)) return null;
    if (!Array.isArray(coords[0])) return coords[0];
    if (!Array.isArray(coords[0][0])) return coords[0][0];
    return coords[0][0][0];
  })();
  if (typeof firstNumber === 'number' && Math.abs(firstNumber) > 180) {
    return 'EPSG:3857';
  }
  return 'EPSG:4326';
};

/**
 * Load GeoJSON layers onto a map
 * @param map - OpenLayers map instance
 * @param data - GeoJSON data for buildings, lines, mv_lines, transformers
 * @param options - Optional configuration
 * @returns Object containing created layers and sources
 */
export const loadGridLayers = (
  map: OLMap,
  data: GridLayerData,
  _options?: { enable3D?: boolean },
): LoadLayersResult => {
  const format = new GeoJSON();
  const layers: VectorLayer<VectorSource>[] = [];
  const allFeatures: Feature<Geometry>[] = [];
  let buildingSource: VectorSource | null = null;

  // Build transformer color map for consistent coloring
  const transformerIds = new Set<number>();
  if (data.buildings?.features) {
    data.buildings.features.forEach((f: any) => {
      const tId = f.properties?.grid_result_id ?? f.properties?.transformer_id;
      if (tId !== undefined && tId !== null) {
        transformerIds.add(typeof tId === 'number' ? tId : Number.parseInt(String(tId), 10));
      }
    });
  }
  if (data.lines?.features) {
    data.lines.features.forEach((f: any) => {
      const tId = f.properties?.grid_result_id;
      if (tId !== undefined && tId !== null) {
        transformerIds.add(typeof tId === 'number' ? tId : Number.parseInt(String(tId), 10));
      }
    });
  }

  const uniqueTransformerIds = Array.from(transformerIds).sort((a, b) => a - b);
  const transformerColorMap = new Map<number, number>();
  uniqueTransformerIds.forEach((id, index) => {
    transformerColorMap.set(id, index);
  });

  // Add buildings layer
  if (data.buildings?.features && data.buildings.features.length > 0) {
    buildingSource = new VectorSource();
    const dataProjection = getDataProjection(data.buildings);
    const features = format.readFeatures(data.buildings, {
      dataProjection,
      featureProjection: map.getView().getProjection(),
    });

    features.forEach((f: Feature<Geometry>, idx: number) => {
      f.set('feature_type', 'building');
      f.set('building_index', idx);
      const tId = f.get('grid_result_id') ?? f.get('transformer_id');
      if (tId !== undefined && tId !== null) {
        const numId = typeof tId === 'number' ? tId : Number.parseInt(String(tId), 10);
        const colorIndex = transformerColorMap.get(numId);
        if (colorIndex !== undefined) {
          f.set('_color_index', colorIndex);
        }
      }
      f.setStyle(createBuildingStyleFunction(true, false));
    });

    buildingSource.addFeatures(features);
    allFeatures.push(...features);

    const buildingLayer = new VectorLayer({
      source: buildingSource,
      zIndex: 100,
    });
    map.addLayer(buildingLayer);
    layers.push(buildingLayer);
  }

  // Add LV lines layer
  if (data.lines?.features && data.lines.features.length > 0) {
    const lineSource = new VectorSource();
    const dataProjection = getDataProjection(data.lines);
    const features = format.readFeatures(data.lines, {
      dataProjection,
      featureProjection: map.getView().getProjection(),
    });

    features.forEach((f: Feature<Geometry>) => {
      f.set('feature_type', 'cable');
      const tId = f.get('grid_result_id');
      if (tId !== undefined && tId !== null) {
        const numId = typeof tId === 'number' ? tId : Number.parseInt(String(tId), 10);
        const colorIndex = transformerColorMap.get(numId);
        if (colorIndex !== undefined) {
          f.set('_color_index', colorIndex);
        }
      }
    });

    lineSource.addFeatures(features);
    allFeatures.push(...features);

    const lineLayer = new VectorLayer({
      source: lineSource,
      style: createCableStyleFunction(),
      zIndex: 99,
    });
    map.addLayer(lineLayer);
    layers.push(lineLayer);
  }

  // Add MV lines layer
  if (data.mv_lines?.features && data.mv_lines.features.length > 0) {
    const mvLineSource = new VectorSource();
    const dataProjection = getDataProjection(data.mv_lines);
    const features = format.readFeatures(data.mv_lines, {
      dataProjection,
      featureProjection: map.getView().getProjection(),
    });

    features.forEach((f: Feature<Geometry>) => {
      f.set('feature_type', 'mv_line');
    });

    mvLineSource.addFeatures(features);
    allFeatures.push(...features);

    const mvLineLayer = new VectorLayer({
      source: mvLineSource,
      style: createMvLineStyleFunction(),
      zIndex: 98,
    });
    map.addLayer(mvLineLayer);
    layers.push(mvLineLayer);
  }

  // Add transformers layer
  if (data.transformers?.features && data.transformers.features.length > 0) {
    const transformerSource = new VectorSource();
    const dataProjection = getDataProjection(data.transformers);
    const features = format.readFeatures(data.transformers, {
      dataProjection,
      featureProjection: map.getView().getProjection(),
    });

    features.forEach((f: Feature<Geometry>) => {
      f.set('feature_type', 'transformer');
      const tId = f.get('grid_result_id');
      if (tId !== undefined && tId !== null) {
        const numId = typeof tId === 'number' ? tId : Number.parseInt(String(tId), 10);
        const colorIndex = transformerColorMap.get(numId);
        if (colorIndex !== undefined) {
          f.set('_color_index', colorIndex);
        }
      }
    });

    transformerSource.addFeatures(features);
    allFeatures.push(...features);

    const transformerLayer = new VectorLayer({
      source: transformerSource,
      style: createTransformerStyleFunction(),
      zIndex: 102,
    });
    map.addLayer(transformerLayer);
    layers.push(transformerLayer);
  }

  return { layers, buildingSource, allFeatures };
};

/**
 * Remove layers from map
 */
export const removeGridLayers = (map: OLMap, layers: VectorLayer<VectorSource>[]) => {
  layers.forEach(layer => map.removeLayer(layer));
};

interface FitToFeaturesOptions {
  padding?: number | [number, number, number, number];
  duration?: number;
  maxZoom?: number;
}

/**
 * Fit map view to features with optional animation
 */
export const fitToFeatures = (
  map: OLMap,
  features: Feature<Geometry>[],
  options: FitToFeaturesOptions | number = 30
) => {
  if (features.length === 0) return;

  // Handle legacy number parameter
  const opts: FitToFeaturesOptions = typeof options === 'number'
    ? { padding: options }
    : options;

  const padding = opts.padding ?? 30;
  const paddingArray = Array.isArray(padding)
    ? padding
    : [padding, padding, padding, padding];

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  features.forEach(feature => {
    const geom = feature.getGeometry();
    if (geom) {
      const ext = geom.getExtent();
      minX = Math.min(minX, ext[0]);
      minY = Math.min(minY, ext[1]);
      maxX = Math.max(maxX, ext[2]);
      maxY = Math.max(maxY, ext[3]);
    }
  });

  if (minX !== Infinity) {
    map.updateSize();
    map.getView().fit([minX, minY, maxX, maxY], {
      padding: paddingArray,
      maxZoom: opts.maxZoom ?? 18,
      duration: opts.duration ?? 0,
    });
  }
};

/**
 * Load a boundary layer onto the map
 * Shows the administrative boundary of the region containing the grid
 */
export const loadBoundaryLayer = (
  map: OLMap,
  boundaryFeature: GeoJSON.Feature,
  regionName?: string
): VectorLayer<VectorSource> => {
  // Remove existing boundary layer
  map.getLayers().forEach((layer) => {
    if (layer.get('name') === 'boundary') {
      map.removeLayer(layer);
    }
  });

  const geojsonFormat = new GeoJSON();
  const dataProjection = getDataProjection({ features: [boundaryFeature] });

  const features = geojsonFormat.readFeatures(
    { type: 'FeatureCollection', features: [boundaryFeature] },
    { dataProjection, featureProjection: 'EPSG:3857' }
  );

  // Set region name on feature for styling
  if (regionName && features[0]) {
    features[0].set('name', regionName);
  }

  const source = new VectorSource({ features });

  const boundaryLayer = new VectorLayer({
    source,
    style: (feature: FeatureLike, resolution: number): ReturnType<StyleFunction> => {
      const styles = boundaryStyleFunction(feature as Feature<Geometry>, resolution);

      // Add label if feature has name
      const name = feature.get('name');
      const geom = (feature as Feature<Geometry>).getGeometry();
      if (name && geom) {
        styles.push(boundaryLabelStyle(name, geom, resolution));
      }

      return styles;
    },
    zIndex: 50,  // Below buildings/lines but above base map
    properties: { name: 'boundary' }
  });

  map.addLayer(boundaryLayer);
  return boundaryLayer;
};

/**
 * Load multiple region boundaries onto the map as separate layers.
 * Each region gets its own layer named 'available-boundary' so they
 * don't interfere with the single-region 'boundary' layer.
 */
export const loadAvailableBoundaryLayers = (
  map: OLMap,
  regions: Array<{ boundary: GeoJSON.Feature; name: string }>
): VectorLayer<VectorSource>[] => {
  // Remove existing available-boundary layers
  const toRemove: VectorLayer<VectorSource>[] = [];
  map.getLayers().forEach((layer) => {
    if (layer.get('name') === 'available-boundary') {
      toRemove.push(layer as VectorLayer<VectorSource>);
    }
  });
  toRemove.forEach(layer => map.removeLayer(layer));

  const geojsonFormat = new GeoJSON();
  const layers: VectorLayer<VectorSource>[] = [];

  for (const region of regions) {
    const dataProjection = getDataProjection({ features: [region.boundary] });

    const features = geojsonFormat.readFeatures(
      { type: 'FeatureCollection', features: [region.boundary] },
      { dataProjection, featureProjection: 'EPSG:3857' }
    );

    if (features[0]) {
      features[0].set('name', region.name);
    }

    const source = new VectorSource({ features });

    const boundaryLayer = new VectorLayer({
      source,
      style: (feature: FeatureLike, resolution: number): ReturnType<StyleFunction> => {
        const isSelected = feature.get('selected') === true;
        const styleFn = isSelected ? selectedBoundaryStyleFunction : boundaryStyleFunction;
        const styles = styleFn(feature as Feature<Geometry>, resolution);

        const name = feature.get('name');
        const geom = (feature as Feature<Geometry>).getGeometry();
        if (name && geom) {
          styles.push(boundaryLabelStyle(name, geom, resolution));
        }

        return styles;
      },
      zIndex: 50,
      properties: { name: 'available-boundary' }
    });

    map.addLayer(boundaryLayer);
    layers.push(boundaryLayer);
  }

  return layers;
};

/**
 * Highlight a selected region by setting `selected` on its boundary feature
 * and clearing it from all other available-boundary layers, then refreshing styles.
 */
export const highlightSelectedRegionBoundary = (
  map: OLMap,
  regionName: string | null
): void => {
  map.getLayers().forEach((layer) => {
    if (layer.get('name') !== 'available-boundary') return;
    const vectorLayer = layer as VectorLayer<VectorSource>;
    const src = vectorLayer.getSource();
    if (!src) return;

    let hasTarget = false;
    for (const feature of src.getFeatures()) {
      const isTarget = regionName !== null && feature.get('name') === regionName;
      feature.set('selected', isTarget, true);
      if (isTarget) hasTarget = true;
    }

    vectorLayer.setVisible(regionName === null || hasTarget);
    src.changed();
  });
};

/**
 * Load a search result boundary onto the map.
 * Uses a distinct teal/cyan style so it stands out from region boundaries.
 */
export const loadSearchBoundaryLayer = (
  map: OLMap,
  geojsonGeometry: GeoJSON.GeoJsonObject,
  name?: string
): VectorLayer<VectorSource> => {
  // Remove any existing search boundary
  removeSearchBoundaryLayer(map);

  const geojsonFormat = new GeoJSON();

  // Wrap the geometry in a Feature if it's just a geometry object
  const featureCollection = (geojsonGeometry as any).type === 'Feature' || (geojsonGeometry as any).type === 'FeatureCollection'
    ? geojsonGeometry
    : {
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          geometry: geojsonGeometry,
          properties: {}
        }]
      };

  const features = geojsonFormat.readFeatures(featureCollection, {
    dataProjection: 'EPSG:4326',
    featureProjection: 'EPSG:3857'
  });

  if (name && features[0]) {
    features[0].set('name', name);
  }

  const source = new VectorSource({ features });

  const layer = new VectorLayer({
    source,
    style: (feature: FeatureLike, resolution: number): ReturnType<StyleFunction> => {
      const styles = searchBoundaryStyleFunction(feature as Feature<Geometry>, resolution);

      const featureName = feature.get('name');
      const geom = (feature as Feature<Geometry>).getGeometry();
      if (featureName && geom) {
        styles.push(boundaryLabelStyle(featureName, geom, resolution));
      }

      return styles;
    },
    zIndex: 55,
    properties: { name: 'search-boundary' }
  });

  map.addLayer(layer);
  return layer;
};

/**
 * Remove search boundary layer from map
 */
export const removeSearchBoundaryLayer = (map: OLMap): void => {
  const toRemove: any[] = [];
  map.getLayers().forEach((layer) => {
    if (layer.get('name') === 'search-boundary') {
      toRemove.push(layer);
    }
  });
  toRemove.forEach(layer => map.removeLayer(layer));
};


