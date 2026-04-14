/**
 * MapLibre base style — OpenFreeMap Positron (free vector tiles, no API key).
 * Sharp rendering with proper 3D label rotation. No usage limits.
 */
export const BASE_STYLE = 'https://tiles.openfreemap.org/styles/positron';

export const CLUSTER_COLORS = [
  '#3a5d7e', '#4c7440', '#7e4a4a', '#776048', '#5e4e7c',
  '#2e7070', '#946e40', '#3e6c3e', '#6c4e82', '#2e6262',
  '#90683e', '#5e3e70', '#3e6082', '#82623c', '#4e7052',
  '#704e70', '#60723e', '#825252', '#3e7082', '#72723e',
] as const;

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
  selectedFill: 'rgba(245, 158, 11, 0.08)',
  selectedStroke: 'rgba(245, 158, 11, 0.98)',
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
