import { describe, expect, it } from 'vitest';
import { getTechColor, resultFill, resultText } from './tech-colors';

describe('results palette', () => {
  it('gives each item one light and one dark colour, whatever name the chart uses for it', () => {
    const cases: [string, string | undefined, string, string][] = [
      ['pv_supply', undefined, '#E69F00', '#E69F00'],
      ['lineIn', undefined, '#6B7280', '#6B7280'],
      ['grid_trafo_import', undefined, '#6B7280', '#6B7280'],
      ['ambient', undefined, '#F0E442', '#F0E442'],
      ['air_source_heat_pump', undefined, '#0072B2', '#3D8FD1'],
      ['air_conditioner', undefined, '#56B4E9', '#8FD0F5'],
      ['cooling:demand', undefined, '#56B4E9', '#8FD0F5'],
      ['demand', 'power', '#CC79A7', '#CC79A7'],
      ['lineOut', undefined, '#009E73', '#1DB98A'],
      ['grid_trafo_1_export', undefined, '#009E73', '#1DB98A'],
      ['batteryIn', undefined, '#D4D4D8', '#D4D4D8'],
      ['batteryLoss', undefined, '#D4D4D8', '#D4D4D8'],
      ['demand', 'heat', '#D55E00', '#E8742A'],
    ];
    for (const [key, carrier, light, dark] of cases) {
      expect([key, resultFill(key, false, carrier)]).toEqual([key, light]);
      expect([key, resultFill(key, true, carrier)]).toEqual([key, dark]);
    }
  });

  it('puts white text on dark fills and dark text on light ones, switching for grid export', () => {
    expect(resultText('air_source_heat_pump', true)).toBe('#ffffff');
    expect(resultText('pv_supply', false)).toBe('#0C3550');
    expect(resultText('lineOut', false)).toBe('#ffffff');
    expect(resultText('lineOut', true)).toBe('#0C3550');
  });

  it('leaves technologies outside the palette to the technology map', () => {
    expect(resultFill('gas_boiler', false)).toBeUndefined();
    expect(getTechColor('gas_boiler')).toBe('#b45309');
    expect(getTechColor('battery_storage', 0, true)).toBe('#D4D4D8');
  });
});
