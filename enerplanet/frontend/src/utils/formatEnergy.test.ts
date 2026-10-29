import { describe, expect, it } from 'vitest';
import { formatEnergy } from './formatEnergy';

describe('formatEnergy', () => {
  it('keeps whole kWh below 10,000 kWh', () => {
    expect(formatEnergy(0)).toBe('0 kWh');
    expect(formatEnergy(120.4)).toBe('120 kWh');
    expect(formatEnergy(9_999)).toBe('9,999 kWh');
  });

  it('moves to MWh from 10,000 kWh, with one decimal under 100', () => {
    expect(formatEnergy(10_000)).toBe('10.0 MWh');
    expect(formatEnergy(41_751)).toBe('41.8 MWh');
    expect(formatEnergy(218_239)).toBe('218 MWh');
  });

  it('moves to GWh from 10,000 MWh', () => {
    expect(formatEnergy(9_999_000)).toBe('9,999 MWh');
    expect(formatEnergy(12_345_678)).toBe('12.3 GWh');
    expect(formatEnergy(456_000_000_000)).toBe('456,000 GWh');
  });
});
