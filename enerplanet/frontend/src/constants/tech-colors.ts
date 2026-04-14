/**
 * Shared technology color map for charts and visualizations.
 * Single source of truth — replaces duplicated TECH_COLORS across chart components.
 */

const TECH_COLORS: Record<string, string> = {
  // Solar
  'solar': '#f59e0b',
  'pv': '#f59e0b',
  'solar pv': '#f59e0b',
  'pv_supply': '#f59e0b',

  // Wind
  'wind': '#22c55e',
  'wind (onshore)': '#22c55e',
  'wind_supply': '#22c55e',
  'wind_onshore': '#22c55e',
  'wind-turbine_supply': '#22c55e',
  'wind_turbine_supply': '#22c55e',
  'wind (offshore)': '#0ea5e9',

  // Other renewables
  'biomass': '#84cc16',
  'biomass_supply': '#84cc16',
  'geothermal': '#ef4444',
  'geothermal_supply': '#ef4444',
  'hydro': '#06b6d4',

  // Storage
  'battery': '#8b5cf6',
  'battery storage': '#8b5cf6',
  'battery_storage': '#8b5cf6',

  // Grid / Infrastructure
  'grid': '#6b7280',
  'grid import': '#6b7280',
  'transformer': '#94a3b8',
  'transformer_supply': '#6b7280',
  'transmission': '#94a3b8',
  'power_transmission': '#94a3b8',
};

const FALLBACK_COLORS = [
  '#3b82f6', // blue
  '#22c55e', // green
  '#f59e0b', // amber
  '#ef4444', // red
  '#8b5cf6', // violet
  '#06b6d4', // cyan
  '#ec4899', // pink
] as const;

/** Match a technology name to its color via case-insensitive substring lookup. */
export function getTechColor(tech: string, fallbackIndex = 0): string {
  const lower = tech.toLowerCase();

  // Exact match first
  if (TECH_COLORS[lower]) return TECH_COLORS[lower];

  // Substring match
  for (const [key, color] of Object.entries(TECH_COLORS)) {
    if (lower.includes(key)) return color;
  }

  return FALLBACK_COLORS[fallbackIndex % FALLBACK_COLORS.length];
}
