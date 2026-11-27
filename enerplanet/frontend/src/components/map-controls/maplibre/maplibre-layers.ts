import type * as maplibregl from 'maplibre-gl';
import { Popup as MapLibrePopup } from 'maplibre-gl';
import {
  BUILDING_COLORS, LV_LINE_COLORS, MV_LINE_COLORS,
  TRANSFORMER_COLORS, POLYGON_COLORS, BOUNDARY_COLORS, USER_MODEL_COLORS,
} from './maplibre-styles';
import { getTransformerColor } from '@/features/interactive-map/utils/mapStyleUtils';
import { collectTransformerIds } from '@/features/configurator/hooks/useAreaSelect/helpers/gridAssignments';

/** Popup content as text: model titles and region names are user or data input, never HTML. */
function boldText(text: string): HTMLElement {
  const b = document.createElement('b');
  b.textContent = text;
  return b;
}

/**
 * Optimized MapLibre Layer Management.
 * Minimizes expensive GeoJSON processing and ensures stable 3D rendering.
 */

function getClusterKeyFromProps(
  properties: Record<string, unknown> | undefined | null
): string | null {
  if (!properties) return null;
  const rawId =
    properties.grid_result_id ??
    properties.transformer_id ??
    properties.trafo_id ??
    properties.cluster_id ??
    properties.id;
  if (rawId === undefined || rawId === null) return null;
  if (typeof rawId === 'number' && Number.isFinite(rawId)) {
    return `n:${rawId}`;
  }
  const rawText = String(rawId).trim();
  if (!rawText) return null;
  const num = Number(rawText);
  if (Number.isFinite(num)) {
    return `n:${num}`;
  }
  return `s:${rawText}`;
}

type WithProperties = { features?: Array<{ properties?: Record<string, unknown> | null }> } | null | undefined;

/**
 * Cluster colours keyed as getClusterKeyFromProps keys them, matching the 2D map: the transformer ids of
 * buildings and cables, ascending, take the 2D palette in turn.
 */
export function buildClusterColorMap(buildings: WithProperties, lines: WithProperties): Map<string, string> {
  const ids = new Set([...collectTransformerIds(buildings?.features ?? []), ...collectTransformerIds(lines?.features ?? [])]);
  const sorted = [...ids].sort((a, b) => a - b);
  return new Map(sorted.map((id, index) => [`n:${id}`, getTransformerColor(index, 1)]));
}

function assignClusterColors(features: any[], colorMap: Map<string, string>, fallback: string): void {
  for (const f of features) {
    if (!f.properties) f.properties = {};
    const key = getClusterKeyFromProps(f.properties as Record<string, unknown> | undefined);
    f.properties._cluster_key = key ?? '';
    f.properties._cluster_color = key ? (colorMap.get(key) || fallback) : fallback;
  }
}

function clearSource(map: maplibregl.Map, sourceId: string): void {
  const src = map.getSource(sourceId) as maplibregl.GeoJSONSource | undefined;
  if (src) src.setData({ type: 'FeatureCollection', features: [] });
}

function toFeatureCollection(input: any): GeoJSON.FeatureCollection | null {
  if (!input) return null;
  if (input.type === 'FeatureCollection' && Array.isArray(input.features)) {
    return input;
  }
  if (input.type === 'Feature') {
    return { type: 'FeatureCollection', features: [input] };
  }
  return null;
}

// Footprints lie flat in 3D: the buildings themselves are City2TABULA's LoD2
// surfaces (see maplibre-lod2), since the footprint heights are estimates.
// Highlights sit slightly above the footprint so they draw over it.
const HIGHLIGHT_HEIGHT = 0.1;

// A cable without a power flow result has no loading_percent; `to-number` would read the null as 0, a low load.
const loadingPercent: maplibregl.ExpressionSpecification = ['to-number', ['coalesce', ['get', 'loading_percent'], -1], -1];

const separatorWidthExpr: maplibregl.ExpressionSpecification = [
  'interpolate',
  ['linear'],
  ['zoom'],
  13, 0.08,
  15, 0.16,
  17, 0.28,
  19, 0.45,
];

export function addOrUpdateBuildings(
  map: maplibregl.Map,
  geojson: any,
  colorMap: Map<string, string>,
  selectedBuildingOsmIds: string[] = [],
  disabledBuildingOsmIds: string[] = [],
): void {
  if (!geojson?.features?.length) {
    clearSource(map, 'buildings-3d');
    return;
  }

  const selectedSet = new Set(selectedBuildingOsmIds.map(id => String(id).trim()));
  const disabledSet = new Set(disabledBuildingOsmIds);

  // Process features in a single pass
  const polygons = [];
  for (const f of geojson.features) {
    const t = f?.geometry?.type;
    if (t === 'Polygon' || t === 'MultiPolygon') {
      if (!f.properties) f.properties = {};
      const key = getClusterKeyFromProps(f.properties);
      f.properties._cluster_key = key ?? '';
      f.properties._cluster_color = key ? (colorMap.get(key) || BUILDING_COLORS.fallback) : BUILDING_COLORS.fallback;

      const rawOsmId = f.properties.osm_id;
      const osmId = rawOsmId === undefined || rawOsmId === null ? '' : String(rawOsmId).trim();
      f.properties._assign_selected = selectedSet.has(osmId);
      f.properties._disabled = disabledSet.has(osmId);

      polygons.push(f);
    }
  }

  if (!polygons.length) {
    clearSource(map, 'buildings-3d');
    return;
  }

  const fc: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: polygons };
  const existing = map.getSource('buildings-3d') as maplibregl.GeoJSONSource | undefined;

  if (existing) {
    existing.setData(fc);
    return;
  }

  map.addSource('buildings-3d', { type: 'geojson', data: fc });

  // Add layers if they don't exist
  if (!map.getLayer('buildings-3d-shadow')) {
    map.addLayer({
      id: 'buildings-3d-shadow',
      type: 'fill',
      source: 'buildings-3d',
      paint: {
        'fill-color': BUILDING_COLORS.shadow,
        'fill-opacity': BUILDING_COLORS.shadowOpacity,
        'fill-translate': [2, 2],
      },
    });
  }

  if (!map.getLayer('buildings-3d-extrusion')) {
    map.addLayer({
      id: 'buildings-3d-extrusion',
      type: 'fill-extrusion',
      source: 'buildings-3d',
      paint: {
        // A disabled building is grey, the colour of disabled LoD2 models (maplibre-lod2 DISABLED_COLOR).
        'fill-extrusion-color': ['case', ['get', '_disabled'], '#4b5563', ['get', '_cluster_color']],
        'fill-extrusion-height': 0,
        'fill-extrusion-base': 0,
        'fill-extrusion-opacity': 0.92,
        'fill-extrusion-vertical-gradient': true,
      },
    });
  }

  if (!map.getLayer('buildings-3d-separator')) {
    map.addLayer({
      id: 'buildings-3d-separator',
      type: 'line',
      source: 'buildings-3d',
      paint: {
        'line-color': 'rgba(255, 255, 255, 0.85)',
        'line-width': separatorWidthExpr,
        'line-opacity': 0.62,
      },
      layout: { 'line-cap': 'round', 'line-join': 'round' },
    });
  }

  if (!map.getLayer('buildings-3d-connected')) {
    map.addLayer({
      id: 'buildings-3d-connected',
      type: 'fill-extrusion',
      source: 'buildings-3d',
      filter: ['==', ['get', '_cluster_key'], '__none__'],
      paint: {
        'fill-extrusion-color': ['get', '_cluster_color'],
        'fill-extrusion-height': HIGHLIGHT_HEIGHT,
        'fill-extrusion-base': 0,
        'fill-extrusion-opacity': 0.98,
      },
    });
  }

  if (!map.getLayer('buildings-3d-connected-halo')) {
    map.addLayer({
      id: 'buildings-3d-connected-halo',
      type: 'line',
      source: 'buildings-3d',
      filter: ['==', ['get', '_cluster_key'], '__none__'],
      paint: { 'line-color': '#ffffff', 'line-width': 7, 'line-opacity': 0.9 },
      layout: { 'line-cap': 'round', 'line-join': 'round' },
    });
  }

  if (!map.getLayer('buildings-3d-connected-outline')) {
    map.addLayer({
      id: 'buildings-3d-connected-outline',
      type: 'line',
      source: 'buildings-3d',
      filter: ['==', ['get', '_cluster_key'], '__none__'],
      paint: { 'line-color': ['get', '_cluster_color'], 'line-width': 4, 'line-opacity': 1 },
      layout: { 'line-cap': 'round', 'line-join': 'round' },
    });
  }

  if (!map.getLayer('buildings-3d-assign-selected')) {
    map.addLayer({
      id: 'buildings-3d-assign-selected',
      type: 'fill-extrusion',
      source: 'buildings-3d',
      filter: ['==', ['get', '_assign_selected'], true],
      paint: {
        'fill-extrusion-color': ['get', '_cluster_color'],
        'fill-extrusion-height': HIGHLIGHT_HEIGHT,
        'fill-extrusion-base': 0,
        'fill-extrusion-opacity': 0.82,
      },
    });
  }

  if (!map.getLayer('buildings-3d-assign-selected-halo')) {
    map.addLayer({
      id: 'buildings-3d-assign-selected-halo',
      type: 'line',
      source: 'buildings-3d',
      filter: ['==', ['get', '_assign_selected'], true],
      paint: { 'line-color': '#ffffff', 'line-width': 6, 'line-opacity': 0.92 },
      layout: { 'line-cap': 'round', 'line-join': 'round' },
    });
  }

  if (!map.getLayer('buildings-3d-assign-selected-outline')) {
    map.addLayer({
      id: 'buildings-3d-assign-selected-outline',
      type: 'line',
      source: 'buildings-3d',
      filter: ['==', ['get', '_assign_selected'], true],
      paint: { 'line-color': '#2563eb', 'line-width': 3.3, 'line-opacity': 1 },
      layout: { 'line-cap': 'round', 'line-join': 'round' },
    });
  }
}

export function addOrUpdateLvLines(map: maplibregl.Map, geojson: any, colorMap: Map<string, string>): void {
  if (!geojson?.features?.length) {
    clearSource(map, 'lv-lines');
    return;
  }

  assignClusterColors(geojson.features, colorMap, LV_LINE_COLORS.core);

  const existing = map.getSource('lv-lines') as maplibregl.GeoJSONSource | undefined;
  if (existing) {
    existing.setData(geojson);
    return;
  }

  map.addSource('lv-lines', { type: 'geojson', data: geojson });

  if (!map.getLayer('lv-lines-casing')) {
    map.addLayer({
      id: 'lv-lines-casing',
      type: 'line',
      source: 'lv-lines',
      paint: { 'line-color': ['get', '_cluster_color'], 'line-width': 6, 'line-opacity': 0.15, 'line-blur': 2 },
      layout: { 'line-cap': 'round', 'line-join': 'round' },
    });
  }

  if (!map.getLayer('lv-lines-core')) {
    map.addLayer({
      id: 'lv-lines-core',
      type: 'line',
      source: 'lv-lines',
      paint: {
        'line-color': [
          'case',
          ['>=', loadingPercent, 100], 'rgba(239, 68, 68, 0.95)',
          ['>=', loadingPercent, 80], 'rgba(249, 115, 22, 0.95)',
          ['>=', loadingPercent, 60], 'rgba(234, 179, 8, 0.95)',
          ['>=', loadingPercent, 40], 'rgba(132, 204, 22, 0.95)',
          ['>=', loadingPercent, 0], 'rgba(34, 197, 94, 0.95)',
          ['get', '_cluster_color'],
        ],
        'line-width': 2.5,
        'line-opacity': 0.95,
      },
      layout: { 'line-cap': 'round', 'line-join': 'round' },
    });
  }
}

export function addOrUpdateMvLines(map: maplibregl.Map, geojson: any): void {
  if (!geojson?.features?.length) {
    clearSource(map, 'mv-lines');
    return;
  }

  const existing = map.getSource('mv-lines') as maplibregl.GeoJSONSource | undefined;
  if (existing) {
    existing.setData(geojson);
    return;
  }

  map.addSource('mv-lines', { type: 'geojson', data: geojson });

  if (!map.getLayer('mv-lines-glow')) {
    map.addLayer({
      id: 'mv-lines-glow',
      type: 'line',
      source: 'mv-lines',
      paint: { 'line-color': MV_LINE_COLORS.core, 'line-width': 12, 'line-opacity': 0.12, 'line-blur': 2 },
      layout: { 'line-cap': 'round', 'line-join': 'round' },
    });
  }
  if (!map.getLayer('mv-lines-inner')) {
    map.addLayer({
      id: 'mv-lines-inner',
      type: 'line',
      source: 'mv-lines',
      paint: { 'line-color': MV_LINE_COLORS.core, 'line-width': 7, 'line-opacity': 0.3 },
      layout: { 'line-cap': 'round', 'line-join': 'round' },
    });
  }
  if (!map.getLayer('mv-lines-core')) {
    map.addLayer({
      id: 'mv-lines-core',
      type: 'line',
      source: 'mv-lines',
      // Wider than the 2.5 px low-voltage core, so the two read apart in 3D as in 2D.
      paint: { 'line-color': MV_LINE_COLORS.core, 'line-width': 4.5, 'line-opacity': 0.95 },
      layout: { 'line-cap': 'round', 'line-join': 'round' },
    });
  }
}

/**
 * Data-driven connection layer for model results: one straight wire segment per
 * connection (bus0 -> bus1), red when its peak utilisation exceeds 100%.
 */
export function addOrUpdateConnections(map: maplibregl.Map, geojson: GeoJSON.FeatureCollection | null): void {
  if (!geojson?.features?.length) {
    clearSource(map, 'result-connections');
    return;
  }

  const existing = map.getSource('result-connections') as maplibregl.GeoJSONSource | undefined;
  if (existing) {
    existing.setData(geojson);
    return;
  }

  map.addSource('result-connections', { type: 'geojson', data: geojson });

  if (!map.getLayer('result-connections-line')) {
    map.addLayer({
      id: 'result-connections-line',
      type: 'line',
      source: 'result-connections',
      paint: {
        'line-color': ['case', ['==', ['get', 'overloaded'], true], '#ef4444', '#64748b'],
        'line-width': ['case', ['==', ['get', 'overloaded'], true], 4, 2.5],
        'line-opacity': 0.95,
      },
      layout: { 'line-cap': 'round', 'line-join': 'round' },
    });
  }
}

const TRANSFORMER_IMG_ID = 'transformer-3d';
// The 2D map's transformer icon (transformerStyleFunction), white on the cluster colour.
const TRANSFORMER_IMG_URL = '/images/transformer-icon.svg';
const TRANSFORMER_IMG_PX = 48;
// Decoded once per page; each map gets its own copy, since leaving 3D removes the map with its images.
let transformerImg: Promise<ImageData | null> | null = null;

function loadTransformerImage(): Promise<ImageData | null> {
  transformerImg ??= new Promise<ImageData | null>((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = TRANSFORMER_IMG_PX;
      canvas.height = TRANSFORMER_IMG_PX;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, TRANSFORMER_IMG_PX, TRANSFORMER_IMG_PX);
      resolve(ctx.getImageData(0, 0, TRANSFORMER_IMG_PX, TRANSFORMER_IMG_PX));
    };
    img.onerror = () => {
      console.warn(`[3d] transformer icon ${TRANSFORMER_IMG_URL} failed to load`);
      transformerImg = null;
      resolve(null);
    };
    img.src = TRANSFORMER_IMG_URL;
  });
  return transformerImg;
}

async function ensureTransformerImage(map: maplibregl.Map): Promise<void> {
  if (map.hasImage(TRANSFORMER_IMG_ID)) return;
  const image = await loadTransformerImage();
  // Drawn at twice the 24 px icon, so it stays sharp on high-density screens.
  if (image && !map.hasImage(TRANSFORMER_IMG_ID)) map.addImage(TRANSFORMER_IMG_ID, image, { pixelRatio: 2 });
}

export function addOrUpdateTransformers(map: maplibregl.Map, geojson: any, colorMap: Map<string, string>): void {
  if (!geojson?.features?.length) {
    clearSource(map, 'transformers');
    return;
  }

  assignClusterColors(geojson.features, colorMap, TRANSFORMER_COLORS.body);

  ensureTransformerImage(map).then(() => {
    const existing = map.getSource('transformers') as maplibregl.GeoJSONSource | undefined;
    if (existing) {
      existing.setData(geojson);
      return;
    }

    map.addSource('transformers', { type: 'geojson', data: geojson });

    map.addLayer({
      id: 'transformers-base',
      type: 'circle',
      source: 'transformers',
      paint: { 'circle-radius': 19, 'circle-color': TRANSFORMER_COLORS.glow, 'circle-blur': 0.4 },
    });
    map.addLayer({
      id: 'transformers-cluster',
      type: 'circle',
      source: 'transformers',
      paint: {
        'circle-radius': 13,
        'circle-color': '#ffffff',
        'circle-stroke-color': ['get', '_cluster_color'],
        'circle-stroke-width': 2.5,
      },
    });
    map.addLayer({
      id: 'transformers-inner',
      type: 'circle',
      source: 'transformers',
      paint: { 'circle-radius': 10, 'circle-color': ['get', '_cluster_color'] },
    });
    map.addLayer({
      id: 'transformers-extrusion',
      type: 'symbol',
      source: 'transformers',
      layout: { 'icon-image': TRANSFORMER_IMG_ID, 'icon-size': 0.7, 'icon-allow-overlap': true, 'icon-anchor': 'center' },
    });
    map.addLayer({
      id: 'transformers-label',
      type: 'symbol',
      source: 'transformers',
      layout: {
        'text-field': ['concat', ['to-string', ['coalesce', ['get', 'rated_power_kva'], '']], ' kVA'],
        'text-size': 9,
        'text-font': ['Noto Sans Bold'],
        'text-offset': [0, 1.9],
        'text-anchor': 'top',
        'text-allow-overlap': true,
      },
      paint: { 'text-color': ['get', '_cluster_color'], 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 },
    });
  }).catch(() => {});
}

export function addOrUpdateRegionBoundaries(
  map: maplibregl.Map,
  availableBoundaryGeoJSON?: any,
  visible: boolean = true,
): void {
  if (!visible) {
    clearSource(map, 'region-boundaries-available');
    return;
  }

  const availableFC = toFeatureCollection(availableBoundaryGeoJSON) || { type: 'FeatureCollection', features: [] };

  const availableSource = map.getSource('region-boundaries-available') as maplibregl.GeoJSONSource | undefined;
  if (availableSource) { availableSource.setData(availableFC); }
  else { map.addSource('region-boundaries-available', { type: 'geojson', data: availableFC }); }

  if (map.getLayer('region-boundaries-available-fill')) return;

  const fillBeforeId = map.getLayer('buildings-3d-shadow') ? 'buildings-3d-shadow' : undefined;

  map.addLayer({
    id: 'region-boundaries-available-fill',
    type: 'fill',
    source: 'region-boundaries-available',
    paint: { 'fill-color': BOUNDARY_COLORS.availableFill, 'fill-opacity': 1 },
  }, fillBeforeId);

  map.addLayer({
    id: 'region-boundaries-available-line',
    type: 'line',
    source: 'region-boundaries-available',
    paint: { 'line-color': BOUNDARY_COLORS.availableStroke, 'line-width': 1.4, 'line-dasharray': [3, 2] },
  });
}

export function addOrUpdatePolygon(map: maplibregl.Map, coordinates: [number, number][][] | undefined): void {
  if (!coordinates?.length) {
    clearSource(map, 'user-polygon');
    return;
  }

  const closeRing = (ring: [number, number][]): [number, number][] => {
    if (ring.length < 3) return ring;
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (first[0] === last[0] && first[1] === last[1]) return ring;
    return [...ring, [first[0], first[1]]];
  };
  const fc: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: {},
      geometry: { type: 'MultiPolygon', coordinates: coordinates.map(c => [closeRing(c)]) },
    }, {
      type: 'Feature',
      properties: { corner: true },
      geometry: { type: 'MultiPoint', coordinates: coordinates.flat() },
    }],
  };

  const existing = map.getSource('user-polygon') as maplibregl.GeoJSONSource | undefined;
  if (existing) {
    existing.setData(fc);
    // Layers added since, the 3D buildings among them, would cover the corner handles.
    if (map.getLayer('user-polygon-corner')) map.moveLayer('user-polygon-corner');
    return;
  }

  map.addSource('user-polygon', { type: 'geojson', data: fc });

  // The corners share the source; a line layer would join them all into one line across the areas.
  const areaOnly: maplibregl.FilterSpecification = ['!', ['has', 'corner']];
  map.addLayer({
    id: 'user-polygon-fill',
    type: 'fill',
    source: 'user-polygon',
    filter: areaOnly,
    paint: { 'fill-color': POLYGON_COLORS.fill },
  });
  map.addLayer({
    id: 'user-polygon-stroke',
    type: 'line',
    source: 'user-polygon',
    filter: areaOnly,
    paint: { 'line-color': POLYGON_COLORS.stroke, 'line-width': 2.5 },
  });
  // The corner handles of the 2D drawer's Modify style (PolygonDrawer).
  map.addLayer({
    id: 'user-polygon-corner',
    type: 'circle',
    source: 'user-polygon',
    filter: ['has', 'corner'],
    paint: { 'circle-radius': 6, 'circle-color': '#06b6d4', 'circle-stroke-color': '#0891b2', 'circle-stroke-width': 2 },
  });
}

export function addOrUpdateUserModels(
  map: maplibregl.Map,
  geojson: GeoJSON.FeatureCollection | undefined | null,
): void {
  if (!geojson?.features?.length) {
    clearSource(map, 'user-models');
    return;
  }

  const src = map.getSource('user-models') as maplibregl.GeoJSONSource | undefined;
  if (src) {
    src.setData(geojson);
    return;
  }

  map.addSource('user-models', { type: 'geojson', data: geojson });

  map.addLayer({
    id: 'user-models-fill',
    type: 'fill',
    source: 'user-models',
    paint: { 'fill-color': USER_MODEL_COLORS.fill, 'fill-opacity': 1 },
  });

  map.addLayer({
    id: 'user-models-stroke',
    type: 'line',
    source: 'user-models',
    paint: { 'line-color': USER_MODEL_COLORS.stroke, 'line-width': 2 },
  });
}

export function setupUserModelInteractions(
  map: maplibregl.Map,
  onModelClick?: (modelId: number, status?: string) => void,
): () => void {
  const popup = new MapLibrePopup({ closeButton: false, closeOnClick: false, offset: 12 });
  let hoveredId: number | null = null;

  const onMouseMove = (e: maplibregl.MapMouseEvent) => {
    const features = map.queryRenderedFeatures(e.point, { layers: ['user-models-fill'] });
    if (features.length > 0) {
      const props = features[0].properties;
      const id = props?.model_id;
      map.getCanvas().style.cursor = 'pointer';

      if (id !== hoveredId) {
        hoveredId = id;
        map.setPaintProperty('user-models-fill', 'fill-color', [
          'case', ['==', ['get', 'model_id'], id], USER_MODEL_COLORS.hoverFill, USER_MODEL_COLORS.fill,
        ]);
      }

      popup.setLngLat(e.lngLat).setDOMContent(boldText(String(props?.title || 'Untitled'))).addTo(map);
    } else {
      if (hoveredId !== null) {
        hoveredId = null;
        map.setPaintProperty('user-models-fill', 'fill-color', USER_MODEL_COLORS.fill);
      }
      map.getCanvas().style.cursor = '';
      popup.remove();
    }
  };

  const onMouseLeave = () => {
    hoveredId = null;
    map.getCanvas().style.cursor = '';
    map.setPaintProperty('user-models-fill', 'fill-color', USER_MODEL_COLORS.fill);
    popup.remove();
  };

  const onClick = (e: maplibregl.MapMouseEvent) => {
    const features = map.queryRenderedFeatures(e.point, { layers: ['user-models-fill'] });
    if (features.length > 0 && onModelClick) {
      const id = features[0].properties?.model_id;
      if (id) onModelClick(id, features[0].properties?.status);
    }
  };

  map.on('mousemove', 'user-models-fill', onMouseMove);
  map.on('mouseleave', 'user-models-fill', onMouseLeave);
  map.on('click', 'user-models-fill', onClick);

  return () => {
    map.off('mousemove', 'user-models-fill', onMouseMove);
    map.off('mouseleave', 'user-models-fill', onMouseLeave);
    map.off('click', 'user-models-fill', onClick);
    popup.remove();
  };
}

export function setupBoundaryInteractions(
  map: maplibregl.Map,
  onRegionClick?: (regionName: string) => void,
): () => void {
  const popup = new MapLibrePopup({ closeButton: false, closeOnClick: false, offset: 12 });
  let hoveredName: string | null = null;

  const onMouseMove = (e: maplibregl.MapMouseEvent) => {
    const features = map.queryRenderedFeatures(e.point, { layers: ['region-boundaries-available-fill'] });
    if (features.length > 0) {
      const name = features[0].properties?.name;
      map.getCanvas().style.cursor = 'pointer';

      if (name !== hoveredName) {
        hoveredName = name;
        map.setPaintProperty('region-boundaries-available-fill', 'fill-color', [
          'case', ['==', ['get', 'name'], name], BOUNDARY_COLORS.availableHoverFill, BOUNDARY_COLORS.availableFill,
        ]);
      }

      popup.setLngLat(e.lngLat).setDOMContent(boldText(String(name))).addTo(map);
    } else {
      if (hoveredName) {
        hoveredName = null;
        map.setPaintProperty('region-boundaries-available-fill', 'fill-color', BOUNDARY_COLORS.availableFill);
      }
      map.getCanvas().style.cursor = '';
      popup.remove();
    }
  };

  const onMouseLeave = () => {
    hoveredName = null;
    map.getCanvas().style.cursor = '';
    map.setPaintProperty('region-boundaries-available-fill', 'fill-color', BOUNDARY_COLORS.availableFill);
    popup.remove();
  };

  const onClick = (e: maplibregl.MapMouseEvent) => {
    const features = map.queryRenderedFeatures(e.point, { layers: ['region-boundaries-available-fill'] });
    if (features.length > 0 && onRegionClick) {
      const name = features[0].properties?.name;
      if (name) onRegionClick(name);
    }
  };

  map.on('mousemove', 'region-boundaries-available-fill', onMouseMove);
  map.on('mouseleave', 'region-boundaries-available-fill', onMouseLeave);
  map.on('click', 'region-boundaries-available-fill', onClick);

  return () => {
    map.off('mousemove', 'region-boundaries-available-fill', onMouseMove);
    map.off('mouseleave', 'region-boundaries-available-fill', onMouseLeave);
    map.off('click', 'region-boundaries-available-fill', onClick);
    popup.remove();
  };
}
