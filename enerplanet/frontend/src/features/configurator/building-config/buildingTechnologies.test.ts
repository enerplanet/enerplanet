import { describe, expect, it } from 'vitest';

import { pvCapacityKw, removeTech, setTechField, technologyCards, type BuildingTechs } from './buildingTechnologies';

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

const roof = { surface_id: 'r1', tilt: 30, azimuth: 180, area: 50, usable_share: 0.8 };

describe('technologyCards', () => {
  it('lists each technology with its fields, unbounded sizes as null and PV capacity from the surfaces', () => {
    const cards = technologyCards(techs, [roof], 'plan', {}, t);
    const byId = Object.fromEntries(cards.map((c) => [c.id, c]));

    expect(byId.pv_supply.fields.map((f) => [f.key, f.value, f.editable ?? false])).toEqual([
      ['capacity', 8, false],
      ['cost_energy_cap', 900, true],
    ]);
    expect(byId.battery_storage.fields.map((f) => [f.key, f.value])).toEqual([
      ['cont_energy_cap_max', 5], ['cont_storage_cap_max', null], ['cost_storage_cap', 400],
    ]);
    expect(byId.air_source_heat_pump.fields.map((f) => f.value)).toEqual([null, 3.2, 1200]);
  });

  it('labels sizes as maximum sizes in plan mode only', () => {
    const label = (mode: 'plan' | 'operate') =>
      technologyCards(techs, [], mode, {}, t).find((c) => c.id === 'air_source_heat_pump')!.fields[0].label;
    expect(label('plan')).toBe('buildingConfig.tech.sizeMax');
    expect(label('operate')).toBe('buildingConfig.tech.size');
  });

  it('shows a refused value\'s error under its field', () => {
    const cards = technologyCards(techs, [], 'plan', { 'air_source_heat_pump:cont_energy_eff': 'Must be above 0' }, t);
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

describe('removeTech and pvCapacityKw', () => {
  it('removes one technology without changing the input', () => {
    expect(Object.keys(removeTech(techs, 'battery_storage'))).toEqual(['pv_supply', 'air_source_heat_pump']);
    expect(Object.keys(techs)).toHaveLength(3);
  });

  it('sizes PV from the usable area unless an array sets its capacity', () => {
    expect(pvCapacityKw([roof, { ...roof, surface_id: 'r2', capacity_kw: 3 }])).toBeCloseTo(11, 6);
  });
});
