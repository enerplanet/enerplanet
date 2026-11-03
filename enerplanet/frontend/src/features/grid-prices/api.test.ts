import { describe, expect, it } from 'vitest';
import { defaultFor, gridPriceError, countryPrices, type GridPrice } from './api';

const row = (country: string, imp: number, exp: number): GridPrice => ({ country, import_ct_per_kwh: imp, export_ct_per_kwh: exp, source: '' });

describe('defaultFor', () => {
  const prices = [row('germany', 38.35, 7.7), row('other', 30, 0)];
  it('uses the country row', () => expect(defaultFor(prices, 'Germany')?.country).toBe('germany'));
  it('falls back to other', () => expect(defaultFor(prices, 'austria')?.country).toBe('other'));
  it('finds czechia by the name regions carry', () => expect(defaultFor([...prices, row('czechia', 31.79, 2)], 'Czech Republic')?.country).toBe('czechia'));
});

describe('countryPrices', () => {
  const prices = [row('other', 30, 0), row('netherlands', 40, 9), row('austria', 25, 6), row('germany', 38.35, 7.7)];
  it('lists countries alphabetically without other', () => expect(countryPrices(prices).map(p => p.country)).toEqual(['austria', 'germany', 'netherlands']));
});

describe('gridPriceError', () => {
  it('accepts a feed-in tariff below the purchase price', () => expect(gridPriceError(34, 7.9)).toBeNull());
  it('accepts unset values', () => expect(gridPriceError(null, null)).toBeNull());
  it('rejects a free purchase price', () => expect(gridPriceError(0, 0)).toBe('gridPrices.errors.importPositive'));
  it('rejects a negative feed-in tariff', () => expect(gridPriceError(30, -1)).toBe('gridPrices.errors.exportNegative'));
  it('rejects feed-in above purchase', () => expect(gridPriceError(30, 31)).toBe('gridPrices.errors.exportAboveImport'));
});
