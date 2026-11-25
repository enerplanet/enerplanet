import type { StyleSpecification } from 'maplibre-gl';

/**
 * MapLibre base style: OpenStreetMap raster tiles, the 2D map's base map, so both views show the same map.
 * The glyphs serve the transformer labels' font; OSM is credited by the 2D map's attribution, visible in 3D.
 */
export const BASE_STYLE: StyleSpecification = {
  version: 8,
  glyphs: 'https://fonts.openmaptiles.org/{fontstack}/{range}.pbf',
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      maxzoom: 19,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    },
  },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
};

export const BUILDING_COLORS = {
  fallback: '#9ca3af',
  shadow: '#1a1a2e',
  shadowOpacity: 0.12,
} as const;

export const LV_LINE_COLORS = {
  core: '#3b82f6',
  casing: '#1e3a5f',
} as const;

export const MV_LINE_COLORS = {
  core: '#f97316',
} as const;

export const TRANSFORMER_COLORS = {
  body: '#f59e0b',
  cap: '#ffffff',
  glow: 'rgba(245, 158, 11, 0.15)',
  label: '#374151',
  labelHalo: '#ffffff',
  stroke: '#d97706',
} as const;

export const POLYGON_COLORS = {
  fill: 'rgba(0, 0, 0, 0.05)',
  stroke: '#000000',
  strokeOpacity: 1,
  strokeWidth: 2.5,
} as const;

export const BOUNDARY_COLORS = {
  availableFill: 'rgba(99, 102, 241, 0.10)',
  availableHoverFill: 'rgba(99, 102, 241, 0.22)',
  availableStroke: 'rgba(99, 102, 241, 0.90)',
  availableGlow: 'rgba(99, 102, 241, 0.20)',
  selectedGlow: 'rgba(245, 158, 11, 0.26)',
  labelText: '#312e81',
  labelHalo: '#ffffff',
} as const;

export const USER_MODEL_COLORS = {
  fill: 'rgba(16, 185, 129, 0.12)',
  stroke: 'rgba(16, 185, 129, 0.85)',
  hoverFill: 'rgba(16, 185, 129, 0.25)',
  labelText: '#064e3b',
  labelHalo: '#ffffff',
} as const;

export const INTERACTIVE_LAYERS = [
  'buildings-3d-extrusion',
  'transformers-cluster',
  'transformers-label',
  'transformers-extrusion',
  'transformers-inner',
  'lv-lines-core',
  'mv-lines-core',
] as const;
