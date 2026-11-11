/**
 * Shared technology color map for charts and visualizations.
 * Single source of truth — replaces duplicated TECH_COLORS across chart components.
 */

const DARK_TEXT = '#0C3550';
const WHITE = '#ffffff';

/** Fill and the text drawn on it, per theme. */
interface ResultToken {
  light: { fill: string; text: string };
  dark: { fill: string; text: string };
}

const token = (light: string, dark: string, text: string, darkText = text): ResultToken => ({
  light: { fill: light, text },
  dark: { fill: dark, text: darkText },
});

/** The results palette: one colour per item, the same in every results chart. */
const RESULT_TOKENS = {
  solar: token('#E69F00', '#E69F00', DARK_TEXT),
  gridImport: token('#6B7280', '#6B7280', WHITE),
  ambient: token('#F0E442', '#F0E442', DARK_TEXT),
  heatPump: token('#0072B2', '#3D8FD1', WHITE),
  airConditioner: token('#56B4E9', '#8FD0F5', DARK_TEXT),
  cooling: token('#56B4E9', '#8FD0F5', DARK_TEXT),
  appliances: token('#CC79A7', '#CC79A7', DARK_TEXT),
  gridExport: token('#009E73', '#1DB98A', WHITE, DARK_TEXT),
  battery: token('#D4D4D8', '#D4D4D8', DARK_TEXT),
  spaceHeating: token('#D55E00', '#E8742A', WHITE),
} satisfies Record<string, ResultToken>;

/** End-use demand by carrier. */
const DEMAND_TOKENS: Record<string, ResultToken> = {
  power: RESULT_TOKENS.appliances,
  heat: RESULT_TOKENS.spaceHeating,
  cooling: RESULT_TOKENS.cooling,
};

/** First match wins, so export and battery are tested before the broader grid and solar patterns. */
const TOKEN_PATTERNS: [RegExp, ResultToken][] = [
  [/ambient/, RESULT_TOKENS.ambient],
  [/batter|storage/, RESULT_TOKENS.battery],
  [/air_conditioner|air conditioner/, RESULT_TOKENS.airConditioner],
  [/air_source_heat_pump|^heat pump$/, RESULT_TOKENS.heatPump],
  [/^lineout$|export/, RESULT_TOKENS.gridExport],
  [/^linein$|grid_trafo_import|transformer_supply|^grid( import)?$/, RESULT_TOKENS.gridImport],
  [/pv|solar/, RESULT_TOKENS.solar],
];

/**
 * The palette entry for a technology, flow key or 'carrier:key' flow key; 'demand'
 * takes its carrier from the prefix or from `carrier`.
 */
function resultToken(key: string, carrier = 'power'): ResultToken | undefined {
  const [own, rest] = key.includes(':') ? key.split(':') : [carrier, key];
  const k = rest.toLowerCase();
  if (k === 'demand') return DEMAND_TOKENS[own];
  return TOKEN_PATTERNS.find(([pattern]) => pattern.test(k))?.[1];
}

/** Palette fill for a results item, or undefined when the palette has none. */
export function resultFill(key: string, dark: boolean, carrier?: string): string | undefined {
  return resultToken(key, carrier)?.[dark ? 'dark' : 'light'].fill;
}

/** Text colour on a results item's fill, or undefined when the palette has none. */
export function resultText(key: string, dark: boolean, carrier?: string): string | undefined {
  return resultToken(key, carrier)?.[dark ? 'dark' : 'light'].text;
}

/** Technologies outside the results palette. */
const TECH_COLORS: Record<string, string> = {
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

  // Heat
  'ground_source_heat_pump': '#a09800',
  'electric_boilers': '#ec4899',
  'gas_boiler': '#b45309',

  // Fuel
  'gas_import': '#a16207',

  // Grid / Infrastructure
  'transformer': '#94a3b8',
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

/** Match a technology name to its colour: the results palette first, then a case-insensitive substring lookup. */
export function getTechColor(tech: string, fallbackIndex = 0, dark = false): string {
  const fill = resultFill(tech, dark);
  if (fill) return fill;

  const lower = tech.toLowerCase();

  // Exact match first
  if (TECH_COLORS[lower]) return TECH_COLORS[lower];

  // Substring match
  for (const [key, color] of Object.entries(TECH_COLORS)) {
    if (lower.includes(key)) return color;
  }

  return FALLBACK_COLORS[fallbackIndex % FALLBACK_COLORS.length];
}
