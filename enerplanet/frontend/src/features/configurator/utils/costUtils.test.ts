import { describe, expect, it } from 'vitest';
import type { StructuredModelResults } from '@/features/model-results/types';
import { feedInIncome, netCost, transformStructuredCostBreakdown } from './costUtils';

// Cost rows as stored for an operate run: feed-in revenue is a negative cost.
const results = {
  cost: [
    { from_location: 'ntrafo_200499', costs: 'monetary', techs: 'grid_trafo_200499_import', value: 18405.42 },
    { from_location: 'ntrafo_200499', costs: 'monetary', techs: 'grid_trafo_200499_export', value: -2157.35 },
  ],
} as unknown as StructuredModelResults;

describe('cost totals with feed-in revenue', () => {
  it('subtracts feed-in revenue from the total cost', () => {
    expect(netCost(results.cost)).toBeCloseTo(16248.07, 2);
  });

  it('leaves feed-in revenue out of the cost breakdown', () => {
    const categories = transformStructuredCostBreakdown(results).map((item) => item.value);
    expect(categories).toEqual([18405.42]);
  });

  it('reports the feed-in revenue on its own', () => {
    expect(feedInIncome(results)).toBeCloseTo(2157.35, 2);
  });
});

describe('transformStructuredCostBreakdown', () => {
  it('sums each technology over its buildings and transformers into one slice', () => {
    const out = transformStructuredCostBreakdown({
      cost: [
        { from_location: 'n1', techs: 'air_source_heat_pump_1', costs: 'monetary', value: 100 },
        { from_location: 'n2', techs: 'air_source_heat_pump_2', costs: 'monetary', value: 50 },
        { from_location: 'ntrafo_1', techs: 'grid_trafo_1_import', costs: 'monetary', value: 300 },
        { from_location: 'ntrafo_2', techs: 'grid_trafo_2_import', costs: 'monetary', value: 200 },
      ],
      cost_investment: [{ location: 'n1', techs: 'air_source_heat_pump_1', costs: 'monetary', value: 80 }],
    } as unknown as StructuredModelResults);

    expect(out.map((c) => [c.value, c.locationCount, c.investmentCost])).toEqual([[500, 2, 0], [150, 2, 80]]);
    expect(out[1].category).toBe('Air Source Heat Pump');
  });
});
