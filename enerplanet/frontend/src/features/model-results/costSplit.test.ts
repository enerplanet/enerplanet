import { describe, expect, it } from 'vitest';
import { splitGridPurchase } from './costSplit';

const t = (key: string) => key;

describe('splitGridPurchase', () => {
  const rows = [
    { tech: 'transformer_supply', label: 'Grid', investment: 0, variable: 1000 },
    { tech: 'air_source_heat_pump', label: 'Heat pump', investment: 500, variable: 0 },
  ];

  it('splits the grid purchase by the share of electricity each use takes', () => {
    const out = splitGridPurchase(rows, [
      { techs: 'air_source_heat_pump_1', total: 75 },
      { techs: 'n1_demand', total: 25 },
      { techs: 'battery_storage_1', total: 40 },
      { techs: 'grid_trafo_101720_export', total: 60 },
    ], t);
    expect(out.map(r => [r.label, r.variable])).toEqual([
      ['results.chartLabels.gridForHeating', 750],
      ['results.chartLabels.gridForOtherUse', 250],
      ['Heat pump', 0],
    ]);
  });

  it('leaves the rows unchanged without heating or cooling electricity', () => {
    expect(splitGridPurchase(rows, [{ techs: 'n1_demand', total: 25 }], t)).toBe(rows);
    expect(splitGridPurchase(rows, undefined, t)).toBe(rows);
  });
});
