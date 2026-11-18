import { describe, expect, it } from 'vitest';

import type { Technology } from '@/features/technologies/services/technologyService';

import {
  productOptions, removeTech, setTechField, setTechProduct, technologiesProp, technologyCards, type BuildingTechs,
} from './buildingTechnologies';

const t = (key: string, options?: Record<string, unknown>) => (options?.defaultValue as string | undefined) ?? key;

const techs: BuildingTechs = {
  pv_supply: { alias: 'Photovoltaic Supply', constraints: [{ key: 'cost_energy_cap', value: 900 }, { key: 'tilt', value: 30 }] },
  battery_storage: {
    alias: 'Battery',
    constraints: [
      { key: 'cont_energy_cap_max', value: 5 },
      { key: 'cont_storage_cap_max', value: 'INF' },
      { key: 'cost_storage_cap', value: 400 },
    ],
  },
  air_source_heat_pump: {
    alias: 'Heat pump',
    constraints: [{ key: 'cont_energy_cap_max', value: 'INF' }, { key: 'cont_energy_eff', value: 3.2 }, { key: 'cost_energy_cap', value: 1200 }],
  },
};

describe('technologyCards', () => {
  it('lists each technology but PV with its fields, unbounded sizes as null', () => {
    const cards = technologyCards(techs, 'plan', {}, t);
    const byId = Object.fromEntries(cards.map((c) => [c.id, c]));

    // The configurator draws PV's own card from the pv prop.
    expect(byId.pv_supply).toBeUndefined();
    expect(byId.battery_storage.fields.map((f) => [f.key, f.value])).toEqual([
      ['cont_energy_cap_max', 5], ['cont_storage_cap_max', null], ['cost_storage_cap', 400],
    ]);
    expect(byId.air_source_heat_pump.fields.map((f) => f.value)).toEqual([null, 3.2, 1200]);
  });

  it('labels sizes as maximum sizes in plan mode only', () => {
    const label = (mode: 'plan' | 'operate') =>
      technologyCards(techs, mode, {}, t).find((c) => c.id === 'air_source_heat_pump')!.fields[0].label;
    expect(label('plan')).toBe('buildingConfig.tech.sizeMax');
    expect(label('operate')).toBe('buildingConfig.tech.size');
  });

  it('estimates each card\'s investment from its sizes and costs, and shows only the rates while a size is open', () => {
    const battery = (energy: number | string) => ({
      constraints: [
        { key: 'cont_energy_cap_max', value: 5 }, { key: 'cost_energy_cap', value: 100 },
        { key: 'cont_storage_cap_max', value: energy }, { key: 'cost_storage_cap', value: 400 },
      ],
    });
    const investment = (key: string, tech: BuildingTechs[string]) =>
      technologyCards({ [key]: tech }, 'plan', {}, t)[0].investment;

    expect(investment('battery_storage', battery(10))).toEqual({ amount: 5 * 100 + 10 * 400, currency: 'EUR' });
    expect(investment('battery_storage', battery('INF'))).toEqual({ amount: null, currency: 'EUR', rate: '100 EUR/kW + 400 EUR/kWh' });
    // A gas price is paid per kWh used, not an investment.
    expect(investment('gas_supply', { constraints: [{ key: 'cost_om_con', value: 0.1 }] })).toBeUndefined();
  });

  it('gives each card its type and its headline figures, leaving the investment to its own line', () => {
    const byId = Object.fromEntries(technologyCards(techs, 'plan', {}, t).map((c) => [c.id, c]));
    expect(byId.battery_storage.type).toBe('battery_storage');
    expect(byId.battery_storage.figures).toEqual([
      { label: 'buildingConfig.tech.powerMax', value: 5, unit: 'kW' },
      { label: 'buildingConfig.tech.energyMax', value: null, unit: 'kWh' },
    ]);
    expect(byId.air_source_heat_pump.figures).toEqual([
      { label: 'buildingConfig.tech.sizeMax', value: null, unit: 'kW' },
      { label: 'buildingConfig.tech.cop', value: 3.2, unit: undefined },
    ]);
  });

  it('names the product under the title only when it is not the type\'s default', () => {
    const type = 'battery_storage';
    const subtitle = (tech: BuildingTechs[string]) => technologyCards({ [type]: tech }, 'plan', {}, t)[0].subtitle;
    expect(subtitle({ alias: 'Battery' })).toBeUndefined();
    expect(subtitle({ alias: 'Battery', product: type })).toBeUndefined();
    expect(subtitle({ alias: 'Tesla Powerwall 3', product: 'battery_tesla_pw3' })).toBe('Tesla Powerwall 3');
  });

  it('shows a refused value\'s error under its field', () => {
    const cards = technologyCards(techs, 'plan', { 'air_source_heat_pump:cont_energy_eff': 'Must be above 0' }, t);
    const cop = cards.find((c) => c.id === 'air_source_heat_pump')!.fields.find((f) => f.key === 'cont_energy_eff');
    expect(cop?.error).toBe('Must be above 0');
  });
});

describe('setTechField', () => {
  it('stores a cleared size as unbounded and a number as typed, leaving other constraints', () => {
    const cleared = setTechField(techs, 'battery_storage', 'cont_energy_cap_max', null, t);
    expect('techs' in cleared && cleared.techs.battery_storage.constraints?.[0]).toEqual({ key: 'cont_energy_cap_max', value: 'INF' });

    const typed = setTechField(techs, 'air_source_heat_pump', 'cont_energy_eff', 3.6, t);
    expect('techs' in typed && typed.techs.air_source_heat_pump.constraints).toEqual([
      { key: 'cont_energy_cap_max', value: 'INF' }, { key: 'cont_energy_eff', value: 3.6 }, { key: 'cost_energy_cap', value: 1200 },
    ]);
    expect(techs.air_source_heat_pump.constraints?.[1].value).toBe(3.2);
  });

  it('refuses an empty investment, a negative value and a zero efficiency', () => {
    expect(setTechField(techs, 'pv_supply', 'cost_energy_cap', null, t)).toEqual({ error: 'buildingConfig.tech.required' });
    expect(setTechField(techs, 'battery_storage', 'cont_energy_cap_max', -1, t)).toEqual({ error: 'buildingConfig.tech.notNegative' });
    expect(setTechField(techs, 'air_source_heat_pump', 'cont_energy_eff', 0, t)).toEqual({ error: 'buildingConfig.tech.positive' });
  });
});

describe('removeTech', () => {
  it('removes one technology without changing the input', () => {
    expect(Object.keys(removeTech(techs, 'battery_storage'))).toEqual(['pv_supply', 'air_source_heat_pump']);
    expect(Object.keys(techs)).toHaveLength(3);
  });
});

describe('technologiesProp', () => {
  const noop = () => {};

  it('keeps the tab for a building with no technologies when they can be added', () => {
    const prop = technologiesProp([], noop, noop, noop);
    expect(prop?.items).toEqual([]);
    expect(prop?.onAdd).toBe(noop);
  });

  it('hides the tab for a building with no technologies when nothing can be added', () => {
    expect(technologiesProp([], noop, noop)).toBeUndefined();
  });
});

const product = (key: string, alias: string, constraints: Technology['constraints']): Technology =>
  ({ key, type: 'battery_storage', alias, icon: 'battery', description: '', constraints });

const catalogue: Technology[] = [
  product('battery_storage', 'Battery Storage', [
    { key: 'cont_energy_cap_max', alias: 'Max power', default_value: 10, unit: 'kW', min: 0, max: null },
    { key: 'cont_storage_loss', alias: 'Loss', default_value: 0.0001, unit: '1/h', min: 0, max: 1 },
  ]),
  product('lfp_10', 'LFP 10 kWh', [
    { key: 'cont_energy_cap_max', alias: 'Max power', default_value: 5, unit: 'kW', min: 0, max: null },
    { key: 'cont_storage_cap_max', alias: 'Max storage', default_value: 10, unit: 'kWh', min: 0, max: null },
  ]),
];

const battery: BuildingTechs = {
  battery_storage: { alias: 'Battery Storage', constraints: [{ key: 'cont_energy_cap_max', value: 10 }, { key: 'cont_storage_loss', value: 0.0001 }] },
};

describe('per-building parameters', () => {
  it('shows every stored parameter after the headline ones, with its name and the product\'s unit and limits', () => {
    const [card] = technologyCards(battery, 'operate', {}, t, catalogue);
    expect(card.fields.map((f) => [f.key, f.label, f.unit, f.max])).toEqual([
      ['cont_energy_cap_max', 'buildingConfig.tech.power', 'kW', undefined],
      ['cont_storage_loss', 'Loss', '1/h', 1],
    ]);
  });

  it('refuses a value above the product\'s limit', () => {
    expect(setTechField(battery, 'battery_storage', 'cont_storage_loss', 2, t, catalogue)).toEqual({ error: 'buildingConfig.tech.atMost' });
    const typed = setTechField(battery, 'battery_storage', 'cont_storage_loss', 0.5, t, catalogue);
    expect('techs' in typed && typed.techs.battery_storage.constraints?.[1].value).toBe(0.5);
  });

  it('switches a building to another product at that product\'s values', () => {
    const next = setTechProduct(battery, 'battery_storage', catalogue[1]);
    expect(next.battery_storage).toMatchObject({ alias: 'LFP 10 kWh', product: 'lfp_10' });
    expect(next.battery_storage.constraints).toEqual([{ key: 'cont_energy_cap_max', value: 5 }, { key: 'cont_storage_cap_max', value: 10 }]);
    expect(battery.battery_storage.product).toBeUndefined();
  });

  it('offers a product choice only when the type has more than one product', () => {
    expect(productOptions(catalogue, 'battery_storage').map((o) => o.id)).toEqual(['battery_storage', 'lfp_10']);
    expect(productOptions(catalogue.slice(0, 1), 'battery_storage')).toEqual([]);
  });
});
