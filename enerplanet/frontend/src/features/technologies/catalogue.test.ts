import { describe, it, expect, vi } from 'vitest';
import technologyService, { type Technology } from './services/technologyService';
import { asBuildingTechnology, constraintsForType, defaultConstraints, defaultProduct, loadCatalogue, productsOfType } from './catalogue';

vi.mock('./services/technologyService', () => ({ default: { getAll: vi.fn() } }));

const product = (key: string, type?: string): Technology => ({
  key, type, alias: key, icon: 'flame', description: '',
  constraints: [{ key: 'cont_energy_eff', alias: 'eff', default_value: 3.1, unit: '', min: null, max: null }],
});

const catalogue = [
  product('gas_boiler__condensing_25kw', 'gas_boiler'),
  product('air_source_heat_pump__6kw', 'air_source_heat_pump'),
  product('air_source_heat_pump', 'air_source_heat_pump'),
  product('pv_supply'),
];

describe('catalogue', () => {
  it('lists a type\'s products with the default first', () => {
    expect(productsOfType(catalogue, 'air_source_heat_pump').map((p) => p.key))
      .toEqual(['air_source_heat_pump', 'air_source_heat_pump__6kw']);
  });

  it('takes the product keyed by its type as the default, else the first of the type', () => {
    expect(defaultProduct(catalogue, 'air_source_heat_pump')?.key).toBe('air_source_heat_pump');
    expect(defaultProduct(catalogue, 'gas_boiler')?.key).toBe('gas_boiler__condensing_25kw');
    expect(defaultProduct(catalogue, 'pv_supply')?.key).toBe('pv_supply');
    expect(defaultProduct(catalogue, 'battery_storage')).toBeUndefined();
  });

  it('stores a product on a building under its type, naming the product', () => {
    const tech = asBuildingTechnology(catalogue[1]);
    expect(tech.key).toBe('air_source_heat_pump');
    expect(tech.product).toBe('air_source_heat_pump__6kw');
    expect(defaultConstraints(tech)).toEqual([{ key: 'cont_energy_eff', value: 3.1 }]);
  });
});

describe('loadCatalogue', () => {
  it('fetches the current list on every load, sharing a request still in flight', async () => {
    const getAll = vi.mocked(technologyService.getAll);
    getAll.mockResolvedValueOnce([product('pv_supply')]).mockResolvedValueOnce([product('pv_supply'), product('pv_supply_v1', 'pv_supply')]);

    const [first, same] = await Promise.all([loadCatalogue(), loadCatalogue()]);
    const later = await loadCatalogue();

    expect(first).toBe(same);
    expect(later.map((p) => p.key)).toEqual(['pv_supply', 'pv_supply_v1']);
    expect(getAll).toHaveBeenCalledTimes(2);
  });
});

describe('constraintsForType', () => {
  const constraint = (key: string, default_value: number) => ({ key, alias: key, default_value, unit: '', min: null, max: null });
  const pv: Technology = {
    key: 'pv_supply', type: 'pv_supply', alias: 'PV', icon: 'sun', description: '',
    constraints: [{ id: 7, ...constraint('cost_energy_cap', 900) }, constraint('tilt', 30)],
  };

  it('starts from the default product of the type, without its constraint ids', () => {
    expect(constraintsForType([pv], 'pv_supply', [])).toEqual([constraint('cost_energy_cap', 900), constraint('tilt', 30)]);
  });

  it('keeps the values the user set for parameters the type also has, and drops the rest', () => {
    const edited = [constraint('cost_energy_cap', 750), constraint('cont_energy_eff', 3.1)];
    expect(constraintsForType([pv], 'pv_supply', edited)).toEqual([constraint('cost_energy_cap', 750), constraint('tilt', 30)]);
  });
});
