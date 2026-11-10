import { describe, expect, it } from 'vitest';
import type { StructuredModelResults } from '@/features/model-results/types';
import { getCapacityFactorByTech, mapTechCategory } from './ComparisonCharts';

describe('mapTechCategory', () => {
  it('groups the grid connection rows and heat pumps under their own categories', () => {
    expect(mapTechCategory('grid_trafo_101720_import')).toBe('grid');
    expect(mapTechCategory('grid_trafo_101720_export')).toBe('grid');
    expect(mapTechCategory('air_source_heat_pump_5')).toBe('heatPump');
    expect(mapTechCategory('air_conditioner_1')).toBe('airConditioner');
    expect(mapTechCategory('battery_storage_7')).toBe('storage');
  });
});

describe('getCapacityFactorByTech', () => {
  it('reports a category as its fleet total, not its last unit', () => {
    // Two heat pumps over 8760 h: 24.06 kW giving 43,694 kWh and 48.86 kW giving 106,560 kWh.
    const results = {
      model_capacity_factor: [
        { id: 1, model_id: 1, carrier: 'heat', techs: 'air_source_heat_pump_1', value: 43694 / (24.06 * 8760) },
        { id: 2, model_id: 1, carrier: 'heat', techs: 'air_source_heat_pump_5', value: 106560 / (48.86 * 8760) },
      ],
      carrier_summaries: {
        heat: { prod_aggregates: [{ techs: 'air_source_heat_pump_1', total: 43694 }, { techs: 'air_source_heat_pump_5', total: 106560 }] },
      },
    } as unknown as StructuredModelResults;
    const expected = ((43694 + 106560) / ((24.06 + 48.86) * 8760)) * 100;
    expect(getCapacityFactorByTech(results).heatPump).toBeCloseTo(expected, 6);
  });
});
