import { describe, expect, it } from 'vitest';
import { explicitHeatDemandKwh, estimateYearlyHeatDemand } from './heatDemand';

describe('explicitHeatDemandKwh', () => {
  it('returns a user-entered heat demand', () => {
    expect(explicitHeatDemandKwh({ demand_heat: 12345, heat_demand_estimated: false })).toBe(12345);
    expect(explicitHeatDemandKwh({ yearly_heat_demand_kwh: 500 })).toBe(500);
  });

  it('ignores an estimate saved on the feature', () => {
    expect(explicitHeatDemandKwh({ demand_heat: 12345, heat_demand_estimated: true })).toBeUndefined();
  });

  it('returns undefined when nothing is set', () => {
    expect(explicitHeatDemandKwh({})).toBeUndefined();
    expect(explicitHeatDemandKwh({ demand_heat: 0 })).toBeUndefined();
  });

  it('keeps a saved estimate labelled as estimated when displayed', () => {
    const props = { f_class: 'office', area: 100, demand_heat: 12345, heat_demand_estimated: true };
    expect(estimateYearlyHeatDemand('office', 100, explicitHeatDemandKwh(props))).toEqual({ kwh: 8000, estimated: true });
  });
});

describe('estimateYearlyHeatDemand', () => {
  it('gives a building of unknown use the fallback rate, as the backend does', () => {
    expect(estimateYearlyHeatDemand(undefined, 100)).toEqual({ kwh: 8000, estimated: true });
    expect(estimateYearlyHeatDemand('', 100).kwh).toBe(8000);
  });

  it('keeps unheated classes and buildings without area at zero', () => {
    expect(estimateYearlyHeatDemand('garage', 100).kwh).toBe(0);
    expect(estimateYearlyHeatDemand(undefined, 0).kwh).toBe(0);
  });
});
