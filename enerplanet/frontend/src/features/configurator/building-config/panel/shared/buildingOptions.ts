// Predefined option lists for building parameters.
// Used by both the full Configure view (GeneralConfig) and the Overview quick-edit.

export const BUILDING_TYPE_OPTIONS = [
  { value: 'Single-family House', label: 'Single-family House' },
  { value: 'Terraced House',      label: 'Terraced House'      },
  { value: 'Multi-family House',  label: 'Multi-family House'  },
  { value: 'Apartment Block',     label: 'Apartment Block'     },
  { value: 'Office',              label: 'Office'              },
  { value: 'School',              label: 'School'              },
  { value: 'Retail',              label: 'Retail'              },
  { value: 'Hotel',               label: 'Hotel'               },
];

/** Earliest construction year the year input accepts. */
export const MIN_CONSTRUCTION_YEAR = 1850;

export const COUNTRY_OPTIONS = [
  { value: 'DE', label: 'DE - Germany'     },
  { value: 'AT', label: 'AT - Austria'     },
  { value: 'NL', label: 'NL - Netherlands' },
  { value: 'CZ', label: 'CZ - Czechia'     },
];

/**
 * Maps a construction year to the TABULA period label it falls in. The label is
 * a UI/ignis-lookup concept only; `general.constructionYear` is the stored value.
 * Every year resolves to a period, so callers never need a fallback.
 */
export function yearToConstructionPeriod(year: number): string {
  if (year < 1919) return 'Pre-1919';
  if (year <= 1948) return '1919-1948';
  if (year <= 1957) return '1949-1957';
  if (year <= 1968) return '1958-1968';
  if (year <= 1978) return '1969-1978';
  if (year <= 1983) return '1979-1983';
  if (year <= 1994) return '1984-1994';
  if (year <= 2001) return '1995-2001';
  if (year <= 2009) return '2002-2009';
  return 'Post-2010';
}
