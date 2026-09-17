/**
 * Building energy-performance rating bands for the "Thermal efficiency" badge.
 *
 * IMPORTANT — the numeric thresholds below are provisional, not verified
 * regulation: they follow the general shape of the EU's A–G energy
 * performance certificate concept (Directive 2010/31/EU, recast (EU)
 * 2024/1275), which every member state implements with its OWN exact
 * kWh/(m²·a) band cutoffs in national law (e.g. Germany's Energieausweis
 * under the GEG, France's DPE, the Netherlands' Energielabel). Those real
 * per-country cutoffs differ and are not reproduced here — do not present
 * DEFAULT_DEMAND_BANDS as an official standard.
 *
 * To add a real country's bands once sourced from its actual regulation:
 * add an entry to COUNTRY_DEMAND_BANDS keyed by ISO 3166-1 alpha-2 code,
 * and cite the regulation/document in a comment next to it.
 */

export interface RatingBand {
  /** Upper bound (exclusive) of this band, in kWh/(m²·a). Use Infinity for the last band. */
  maxKwhPerM2: number;
  label: string;
  color: string;
  bg: string;
}

/** Generic fallback scale — illustrative only, see file header. */
export const DEFAULT_DEMAND_BANDS: RatingBand[] = [
  { maxKwhPerM2: 30,       label: 'A+ (Excellent)',     color: '#059669', bg: '#ecfdf5' },
  { maxKwhPerM2: 50,       label: 'A (Very good)',      color: '#16a34a', bg: '#f0fdf4' },
  { maxKwhPerM2: 75,       label: 'B (Good)',           color: '#65a30d', bg: '#f7fee7' },
  { maxKwhPerM2: 100,      label: 'C (Fair)',           color: '#d97706', bg: '#fffbeb' },
  { maxKwhPerM2: 130,      label: 'D (Below average)',  color: '#ea580c', bg: '#fff7ed' },
  { maxKwhPerM2: 160,      label: 'E (Poor)',           color: '#dc2626', bg: '#fef2f2' },
  { maxKwhPerM2: 200,      label: 'F (Very poor)',      color: '#b91c1c', bg: '#fef2f2' },
  { maxKwhPerM2: Infinity, label: 'G (Very poor)',      color: '#9f1239', bg: '#fff1f2' },
];

/**
 * Per-country overrides, keyed by ISO 3166-1 alpha-2 code. Empty until a
 * country's real regulatory bands are sourced and confirmed — this is the
 * extension point the rest of the app already reads from
 * (getThermalRatingFromDemand), so adding a country here is a one-line change
 * with no other code to touch.
 */
export const COUNTRY_DEMAND_BANDS: Partial<Record<string, RatingBand[]>> = {};

/** Returns the rating bands to use for a given country, or the generic fallback. */
export function getDemandRatingBands(countryIso2?: string): RatingBand[] {
  const bands = countryIso2 ? COUNTRY_DEMAND_BANDS[countryIso2.toUpperCase()] : undefined;
  return bands ?? DEFAULT_DEMAND_BANDS;
}

/** Classifies an annual heating demand figure (kWh/(m²·a)) into a rating band. */
export function getThermalRatingFromDemand(kWhPerM2: number, countryIso2?: string): RatingBand {
  const bands = getDemandRatingBands(countryIso2);
  return bands.find((b) => kWhPerM2 < b.maxKwhPerM2) ?? bands[bands.length - 1];
}
