import { describe, expect, it } from 'vitest';
import { buemTotals } from './modelDemandProfiles';

describe('buemTotals', () => {
  it('adds heating, electricity, cooling and hot water, and keeps kitchen gas apart', () => {
    // Building c2t:DEBY_LOD2_107523689 as the configurator shows it: 218,239 kWh in total.
    const totals = buemTotals({
      osm_id: 'c2t:DEBY_LOD2_107523689',
      status: 'resolved',
      heating_kwh_a: 153456,
      electricity_kwh_a: 23032,
      cooling_kwh_a: 41751,
      hot_water_kwh_a: 0,
      kitchen_kwh_a: 120,
    });
    expect(totals).toEqual({ total: 218239, heating: 153456, electricity: 23032, cooling: 41751, hotWater: 0, kitchenGas: 120 });
  });

  it('counts a missing carrier as zero', () => {
    expect(buemTotals({ osm_id: '1', status: 'resolved', heating_kwh_a: 100 })?.total).toBe(100);
  });

  it('has no totals for a building that is not resolved', () => {
    expect(buemTotals({ osm_id: '1', status: 'failed', error_message: 'no envelope' })).toBeNull();
    expect(buemTotals({ osm_id: '1', status: 'pending' })).toBeNull();
  });
});
