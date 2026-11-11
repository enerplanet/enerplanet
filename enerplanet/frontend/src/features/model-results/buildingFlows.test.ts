import { describe, expect, it } from 'vitest';
import { allocateFlows, combineCarriers, netBattery, classifyFlow, heatFigures, installedCapacities, selfSufficiencyShare, modelSelfSufficiency, selfSufficiency, summariseFlows, techFamily, systemFlows, thermalFigures, thermalFlows, flowLabel } from './buildingFlows';

const row = (techs: string, timestep: string, value: number) =>
  ({ id: 0, model_id: 1, from_location: 'n1', carrier: 'power', techs, timestep, value });

describe('buildingFlows', () => {
  it('groups node rows into categories', () => {
    expect(techFamily('pv_supply_1_0')).toBe('pv_supply');
    expect(techFamily('gas_3_import')).toBe('gas_import');
    expect(classifyFlow('n1_demand', 'con')).toEqual({ key: 'demand', side: 'use' });
    expect(classifyFlow('power_transmission:lv_0', 'prod')).toEqual({ key: 'lineIn', side: 'supply' });
    expect(classifyFlow('power_transmission:lv_0', 'con')).toEqual({ key: 'lineOut', side: 'use' });
    expect(classifyFlow('battery_storage_1', 'con')).toEqual({ key: 'batteryIn', side: 'use' });
    expect(classifyFlow('air_source_heat_pump_1', 'con')).toEqual({ key: 'air_source_heat_pump', side: 'use' });
  });

  it('gives the heat pump share, boiler heat and seasonal COP of the heat flows', () => {
    const flow = (key: string, side: 'supply' | 'use', totalKwh: number) =>
      ({ key, side, color: '', totalKwh, peakKw: 0, hourly: [] });
    const flows = [flow('air_source_heat_pump', 'supply', 300), flow('boiler', 'supply', 100), flow('demand', 'use', 400)];
    expect(heatFigures(flows, 100)).toEqual({ heatPumpShare: 0.75, boilerKwh: 100, seasonalCop: 3 });
    expect(heatFigures(flows)).toEqual({ heatPumpShare: 0.75, boilerKwh: 100, seasonalCop: null });
    expect(heatFigures([flow('boiler', 'supply', 100)], 50)).toEqual({ heatPumpShare: null, boilerKwh: 100, seasonalCop: null });
  });

  it('sums energy, peaks and self-sufficiency', () => {
    const { flows } = summariseFlows(
      [row('pv_supply_1_0', 't1', 3), row('power_transmission:lv_0', 't2', 2)],
      [row('n1_demand', 't1', -1), row('n1_demand', 't2', -1), row('air_source_heat_pump_1', 't1', -2)],
    );
    const demand = flows.find((f) => f.key === 'demand')!;
    expect(demand.totalKwh).toBe(2);
    expect(demand.peakKw).toBe(1);
  });

  it('drops flows too small to show as 0.1 kWh (solver noise)', () => {
    const { flows } = summariseFlows(
      [row('pv_supply_1_0', 't1', 3)],
      [row('n1_demand', 't1', -3), row('grid_trafo_1_export', 't1', -0.0014)],
    );
    expect(flows.map((f) => f.key)).toEqual(['demand', 'pv_supply']);
  });

  it('splits each hour of supply over that hour of uses', () => {
    const { flows } = summariseFlows(
      [row('pv_supply_1_0', 't1', 3), row('power_transmission:lv_0', 't2', 2)],
      [row('n1_demand', 't1', -1), row('power_transmission:lv_0', 't1', -2),
        row('n1_demand', 't2', -1), row('air_source_heat_pump_1', 't2', -1)],
    );
    const links = Object.fromEntries(allocateFlows(flows).map((l) => [`${l.from}>${l.to}`, l.kwh]));
    expect(links).toEqual({
      'pv_supply>demand': 1,
      'pv_supply>lineOut': 2,
      'lineIn>demand': 1,
      'lineIn>air_source_heat_pump': 1,
    });
  });
});

describe('gas import', () => {
  it('colours gas import as gas, not with the fallback blue', () => {
    const gas = summariseFlows([row('gas_1_import', 't1', 10)], [row('gas_boiler_1', 't1', -10)], 'natural_gas').flows;
    expect(gas.find((f) => f.key === 'gas_import')?.color).toBe('#a16207');
  });
});

describe('systemFlows', () => {
  it('drops line flows between buildings and keeps grid import and export', () => {
    const row = (techs: string, value: number) => ({ techs, value, timestep: '2023-01-01 00:00:00', carrier: 'power' });
    const { flows } = systemFlows(
      [row('transformer_supply', 5), row('power_transmission:lv_1', 9), row('pv_supply_1_0', 3)] as never,
      [row('n1_demand', -6), row('power_transmission:lv_1', -9), row('grid_trafo_1_export', -2)] as never,
    );
    expect(Object.fromEntries(flows.map((f) => [f.key, f.totalKwh]))).toEqual({ pv_supply: 3, lineIn: 5, demand: 6, lineOut: 2 });
  });
});

describe('netBattery', () => {
  it('replaces charging and discharging with the losses, and the bars still balance', () => {
    const { flows } = summariseFlows(
      [row('pv_supply_1_0', 't1', 10), row('battery_1', 't2', 9), row('power_transmission:lv_0', 't2', 2)],
      [row('battery_1', 't1', -10), row('n1_demand', 't2', -11)],
    );
    const net = netBattery(flows);
    const sum = (side: string) => net.filter((f) => f.side === side).reduce((s, f) => s + f.totalKwh, 0);
    expect(Object.fromEntries(net.map((f) => [f.key, f.totalKwh]))).toEqual({ pv_supply: 10, lineIn: 2, demand: 11, batteryLoss: 1 });
    expect(sum('supply')).toBe(sum('use'));
    expect(netBattery(flows.filter((f) => !f.key.startsWith('battery')))).toHaveLength(3);
  });
});

describe('self-sufficiency', () => {
  it('is the share of electricity used that was not bought from the grid', () => {
    expect(selfSufficiencyShare(13.5, 23.17)).toBeCloseTo(0.417, 3);
    expect(selfSufficiencyShare(0, 2)).toBe(1);
    expect(selfSufficiencyShare(3, 2)).toBe(0);
    expect(selfSufficiencyShare(0, 0)).toBeNull();
  });

  it('does not count battery losses as electricity used on site', () => {
    const { flows } = summariseFlows(
      [row('pv_supply_1_0', 't1', 4), row('battery_storage_1', 't2', 0.9), row('power_transmission:lv_0', 't2', 1.1)],
      [row('n1_demand', 't1', -1), row('battery_storage_1', 't1', -1), row('power_transmission:lv_0', 't1', -2),
        row('n1_demand', 't2', -1), row('air_source_heat_pump_1', 't2', -1)],
    );
    // 3 kWh used, 1.1 kWh from the street line; 1 kWh charged, 0.9 kWh discharged.
    expect(selfSufficiency(flows)).toBeCloseTo(1 - 1.1 / 3);
  });
});

describe('modelSelfSufficiency', () => {
  it('reads grid import and use from the model totals, battery losses not counted as used', () => {
    // Totals of a 7-building operate run: 36.89 MWh PV, 12.66 MWh into batteries, 11.40 MWh out, no export.
    const results = {
      sum_consumption: 96_170,
      grid_import: 60_540,
      prod_aggregates: [{ techs: 'pv_supply_1_0:n1', total: 36_890 }, { techs: 'transformer_supply:t1', total: 60_540 }],
      con_aggregates: [{ techs: 'battery_storage_1:n1', total: -12_660 }],
    };
    expect(modelSelfSufficiency(results as never)).toBeCloseTo(0.3705, 4);
    expect(modelSelfSufficiency({ sum_consumption: 0 } as never)).toBe(0);
  });
});

describe('installedCapacities', () => {
  it('sums each technology over buildings, counts buildings not roof surfaces, and reads battery storage from the second row', () => {
    const cap = (id: number, tech: string, from_location: string, value: number) => ({ id, model_id: 2, from_location, tech, value });
    // Rows as stored: battery storage rows follow the power rows.
    const rows = [
      cap(30, 'air_source_heat_pump_1', 'n1', 25), cap(31, 'air_source_heat_pump_2', 'n2', 16.4),
      cap(34, 'battery_storage_1', 'n1', 10), cap(37, 'battery_storage_4', 'n4', 10),
      cap(38, 'battery_storage_4', 'n4', 0.02), cap(39, 'battery_storage_1', 'n1', 0.02),
      cap(40, 'pv_supply_1_0', 'n1', 7.6), cap(41, 'n1_demand', 'n1', 9), cap(42, 'transformer_supply', 'n0', 630),
      cap(43, 'power_transmission', 'n1', 50), cap(44, 'battery_storage_7', 'n7', 0), cap(45, 'battery_storage_7', 'n7', 0),
      cap(46, 'pv_supply_1_1', 'n1', 2), cap(47, 'gas_1_import', 'n1', 30), cap(48, 'grid_trafo_1_export', 't1', 630),
    ];
    expect(installedCapacities(rows)).toEqual([
      { family: 'air_source_heat_pump', kw: 41.4, kwh: 0, units: 2 },
      { family: 'battery_storage', kw: 20, kwh: 40, units: 2 },
      { family: 'pv_supply', kw: 9.6, kwh: 0, units: 1 },
    ]);
  });

  it('combines heating and cooling: shares, the electricity behind them, and one timeline', () => {
    const flow = (key: string, side: 'supply' | 'use', hourly: number[]) =>
      ({ key, side, color: '', totalKwh: hourly.reduce((a, b) => a + b, 0), peakKw: Math.max(...hourly), hourly });
    const results = [
      { carrier: 'power', timesteps: ['t1', 't2'], flows: [flow('air_source_heat_pump', 'use', [1, 0]), flow('air_conditioner', 'use', [0, 1]), flow('demand', 'use', [5, 5])] },
      { carrier: 'heat', timesteps: ['t1', 't2'], flows: [flow('air_source_heat_pump', 'supply', [3, 0]), flow('demand', 'use', [3, 0])] },
      { carrier: 'cooling', timesteps: ['t2'], flows: [flow('air_conditioner', 'supply', [1]), flow('demand', 'use', [1])] },
    ];
    expect(thermalFigures(results)).toEqual({ totalKwh: 4, heatKwh: 3, coolingKwh: 1, electricityKwh: 2, heatShare: 0.75, coolingShare: 0.25 });
    expect(thermalFlows(results).map((f) => f.key)).toEqual(['heat:air_source_heat_pump', 'heat:demand', 'cooling:air_conditioner', 'cooling:demand']);
    const t = (_key: string, fallback: string) => fallback;
    expect(flowLabel('cooling:demand', 'heat', t)).toBe('Cooling');
    expect(flowLabel('heat:demand', 'cooling', t)).toBe('Space heating and hot water');
    const both = combineCarriers(results.slice(1));
    expect(both.flows.map((f) => [f.key, f.side, f.hourly])).toEqual([
      ['heat:air_source_heat_pump', 'supply', [3, 0]], ['heat:demand', 'use', [3, 0]],
      ['cooling:air_conditioner', 'supply', [0, 1]], ['cooling:demand', 'use', [0, 1]],
    ]);
  });
});
