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
