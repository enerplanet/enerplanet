import { describe, it, expect, vi } from 'vitest';
import technologyService, { type Technology } from './services/technologyService';
import { asBuildingTechnology, defaultConstraints, defaultProduct, loadCatalogue, productsOfType } from './catalogue';

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
