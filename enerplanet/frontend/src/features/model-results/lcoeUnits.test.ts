import { describe, it, expect } from 'vitest';
import {
  energyKwhFromCost,
  formatLcoeCtkwh,
  formatLcoeEurPerKwh,
  lcoeToCtkwh,
  lcoeToEurPerKwh,
} from './lcoeUnits';

describe('lcoeUnits', () => {
  it('treats the stored value as EUR per MWh, not per kWh', () => {
    // A grid-only model whose tariff is 300 EUR/MWh stores exactly 300.
    expect(lcoeToCtkwh(300)).toBe(30);
    expect(lcoeToEurPerKwh(300)).toBe(0.3);
    expect(formatLcoeCtkwh(300)).toBe('30.00 ct/kWh');
    expect(formatLcoeEurPerKwh(300)).toBe('€0.300/kWh');
  });

  it('scales linearly for other tariffs', () => {
    expect(lcoeToCtkwh(450)).toBe(45);
    expect(lcoeToCtkwh(0)).toBe(0);
    expect(lcoeToCtkwh(12.5)).toBeCloseTo(1.25, 10);
  });

  it('is safe for absent or non-finite values', () => {
    expect(lcoeToCtkwh(undefined)).toBe(0);
    expect(lcoeToCtkwh(null)).toBe(0);
    expect(lcoeToCtkwh(NaN)).toBe(0);
  });

  it('derives served energy in kWh from cost and levelised cost', () => {
    // 966.96 € at 300 EUR/MWh = 3.2232 MWh = 3223.2 kWh
    expect(energyKwhFromCost(966.96, 300)).toBeCloseTo(3223.2, 1);
    expect(energyKwhFromCost(100, 0)).toBe(0);
    expect(energyKwhFromCost(NaN, 300)).toBe(0);
  });
});
