import { DEFAULT_PV_MODULE, type TechnologyProduct } from '@thd-spatial-ai/building-configurator';
import { describe, expect, it } from 'vitest';

import { moduleOf, productCopies } from './pvProducts';

const facade: TechnologyProduct = {
  id: 'facade', key: 'facade', type: 'pv_supply', alias: 'Facade 400 W',
  constraints: [
    { key: 'cost_energy_cap', default_value: 900 },
    { key: 'module_width_m', default_value: 1.05 },
    { key: 'module_height_m', default_value: 1.76 },
    { key: 'module_power_kwp', default_value: 0.4 },
  ],
};

describe('productCopies', () => {
  it('copies each named product once, keeping a stored copy over the catalogue', () => {
    const stored = { roof: { alias: 'Roof as saved', constraints: [{ key: 'cost_energy_cap', value: 1100 }] } };
    const roofNow: TechnologyProduct = { id: 'roof', key: 'roof', type: 'pv_supply', alias: 'Roof edited', constraints: [] };

    const copies = productCopies(
      [{ product_id: 'facade' }, { product_id: 'facade' }, { product_id: 'roof' }, {}],
      stored,
      [facade, roofNow],
    );

    expect(Object.keys(copies).sort()).toEqual(['facade', 'roof']);
    expect(copies.facade.constraints).toContainEqual({ key: 'cost_energy_cap', value: 900 });
    expect(copies.roof.alias).toBe('Roof as saved');
  });

  it('leaves out a product neither stored nor in the catalogue', () => {
    expect(productCopies([{ product_id: 'gone' }], undefined, [facade])).toEqual({});
  });
});

describe('moduleOf', () => {
  it('reads the module size and power', () => {
    const { constraints } = productCopies([{ product_id: 'facade' }], undefined, [facade]).facade;
    expect(moduleOf(constraints)).toEqual({ width: 1.05, height: 1.76, kwp: 0.4 });
  });

  it('falls back to the default module without all three parameters', () => {
    expect(moduleOf([{ key: 'module_width_m', value: 1.05 }])).toBe(DEFAULT_PV_MODULE);
    expect(moduleOf(undefined)).toBe(DEFAULT_PV_MODULE);
  });
});
