import axios from '@/lib/axios';

/** A country's default grid electricity prices, as administrators keep them. */
export interface GridPrice {
  country: string;
  import_ct_per_kwh: number;
  export_ct_per_kwh: number;
  source: string;
  updated_by?: string;
  updated_at?: string;
}

/** The row that applies to a country without its own. */
export const FALLBACK_COUNTRY = 'other';

/** Every country's default grid prices. */
export async function fetchGridPrices(): Promise<GridPrice[]> {
  const response = await axios.get<{ success: boolean; data: GridPrice[] }>('/settings/grid-prices');
  return response.data.data ?? [];
}

/** Creates or replaces one country's default prices (managers and experts). */
export async function saveGridPrice(price: Pick<GridPrice, 'country' | 'import_ct_per_kwh' | 'export_ct_per_kwh' | 'source'>): Promise<GridPrice> {
  const response = await axios.put<{ success: boolean; data: GridPrice }>('/settings/grid-prices', price);
  return response.data.data;
}

/** A country name as the price table keys it. */
const countryKey = (country: string | undefined): string => (country ?? '').trim().toLowerCase().replace(/\s+/g, '_');

/** The default that applies to a model's country: its own row, else the fallback row. */
export function defaultFor(prices: GridPrice[], country: string | undefined): GridPrice | undefined {
  const key = countryKey(country);
  return prices.find(p => p.country === key) ?? prices.find(p => p.country === FALLBACK_COUNTRY);
}

/** The countries with their own prices, alphabetically, without the fallback row. */
export function countryPrices(prices: GridPrice[]): GridPrice[] {
  return prices.filter(p => p.country !== FALLBACK_COUNTRY).sort((a, b) => a.country.localeCompare(b.country));
}

/** The reason a pair of prices is rejected, as a locale key, or null when valid. */
export function gridPriceError(importCt: number | null, exportCt: number | null): string | null {
  if (importCt !== null && !(importCt > 0)) return 'gridPrices.errors.importPositive';
  if (exportCt !== null && exportCt < 0) return 'gridPrices.errors.exportNegative';
  if (importCt !== null && exportCt !== null && exportCt > importCt) return 'gridPrices.errors.exportAboveImport';
  return null;
}
