import { describe, it, expect } from 'vitest';
import {
  computeBottlenecks,
  analyzeBottleneck,
  wireLossKw,
  apparentPowerKva,
  type LineLoadingRow,
} from './bottlenecks';

const rows = (over: Partial<LineLoadingRow> & { line: string }, n = 1): LineLoadingRow[] =>
  Array.from({ length: n }, (_, i) => ({
    timestep: String(i),
    bus0: 'a',
    bus1: 'b',
    p0: 100,
    p1: 90,
    loading_percent: 70,
    ...over,
  }));

describe('wireLossKw / apparentPowerKva', () => {
  it('computes conductor loss as |P_out|-|P_in|', () => {
    expect(wireLossKw(100, 90)).toBe(10);
    expect(wireLossKw(-100, -90)).toBe(10);
    expect(wireLossKw(100, undefined)).toBe(0);
  });

  it('computes peak apparent power across endpoints', () => {
    expect(apparentPowerKva(100, 40)).toBe(100);
    expect(apparentPowerKva(0, 0)).toBe(0);
  });
});

describe('computeBottlenecks', () => {
  it('flags wires at/above the near threshold, sorted by loading desc', () => {
    const result = computeBottlenecks(
      [
        ...rows({ line: 'high', loading_percent: 120 }, 2),
        ...rows({ line: 'mid', loading_percent: 90 }, 2),
        ...rows({ line: 'ok', loading_percent: 50 }, 2),
      ],
      {},
      0.1,
      1,
    );
    expect(result.map(r => r.line)).toEqual(['high', 'mid']);
    expect(result[0].status).toBe('overload');
    expect(result[1].status).toBe('near');
  });

  it('derives loading% from rating when not declared', () => {
    const result = computeBottlenecks(
      rows({ line: 'rated', p0: 500, p1: 480, loading_percent: undefined }, 2),
      { rated: 400 },
      0.1,
      1,
    );
    expect(result[0].peakLoadingPercent).toBeCloseTo(125);
    expect(result[0].status).toBe('overload');
  });

  it('monetises measured loss at LCOE and estimates upgrade saving', () => {
    // 2 steps x 10 kW loss x 1 h = 20 kWh; LCOE 0.1 -> 2 EUR loss cost.
    const item = analyzeBottleneck('w', rows({ line: 'w', loading_percent: 120 }, 2), 120, 0.1, 1);
    expect(item.annualLossKwh).toBeCloseTo(20);
    expect(item.annualLossCostEur).toBeCloseTo(2);
    // upgrade factor = (50/120)^2 ~ 0.1736 -> ~3.47 kWh -> ~0.347 EUR.
    expect(item.estimatedUpgradeLossKwh).toBeCloseTo(3.472, 1);
    expect(item.estimatedSavingEurPerPeriod).toBeCloseTo(1.653, 1);
  });

  it('respects hoursPerTimestep in the kWh total', () => {
    const item = analyzeBottleneck('w', rows({ line: 'w', loading_percent: 120 }, 2), 120, 0.1, 0.5);
    expect(item.annualLossKwh).toBeCloseTo(10); // 2 x 10 kW x 0.5 h
    expect(item.annualLossCostEur).toBeCloseTo(1);
  });

  it('omits wires below the near threshold', () => {
    const result = computeBottlenecks(rows({ line: 'ok', loading_percent: 40 }), {}, 0.1, 1);
    expect(result).toHaveLength(0);
  });

  it('omits wires with flow but no rating% (cannot judge a bottleneck)', () => {
    const result = computeBottlenecks(
      rows({ line: 'no-rating', loading_percent: undefined, p0: 50, p1: 0 }),
      {},
      0.1,
      1,
    );
    expect(result).toHaveLength(0);
  });

  it('recommends re-rating multiplier of peak/target', () => {
    const item = analyzeBottleneck('w', rows({ line: 'w', loading_percent: 100 }), 100, 0.1, 1);
    expect(item.recommendedRatingMultiplier).toBe(2);
  });
});