import { DEFAULT_PV_MODULE, type TechnologyProduct } from '@thd-spatial-ai/building-configurator';
import { describe, expect, it } from 'vitest';

import { moduleOf, productCopies, withProductValue, withValues } from './pvProducts';

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

describe('withProductValue', () => {
  const ownValues = [{ key: 'losses', value: 0.14 }, { key: 'inv_eff', value: 0.96 }];

  it('sets the building product\'s value in the building\'s own values and keeps its copy in step', () => {
    const copies = { pv_supply: { alias: 'PV', constraints: [{ key: 'losses', value: 0.14 }] } };

    const next = withProductValue({ constraints: ownValues, copies }, 'pv_supply', 'losses', 0.2, 'pv_supply', [facade]);

    expect(next.constraints).toEqual([{ key: 'losses', value: 0.2 }, { key: 'inv_eff', value: 0.96 }]);
    expect(next.copies?.pv_supply.constraints).toEqual([{ key: 'losses', value: 0.2 }]);
  });

  it('copies another product from the catalogue on its first edit, then edits the copy', () => {
    const first = withProductValue({ constraints: ownValues }, 'facade', 'cost_energy_cap', 950, 'pv_supply', [facade]);
    const second = withProductValue(first, 'facade', 'dc_ac_ratio', 1.2, 'pv_supply', [facade]);

    expect(second.constraints).toBe(ownValues);
    expect(second.copies?.facade.alias).toBe('Facade 400 W');
    expect(second.copies?.facade.constraints).toContainEqual({ key: 'cost_energy_cap', value: 950 });
    expect(second.copies?.facade.constraints).toContainEqual({ key: 'module_power_kwp', value: 0.4 });
    expect(second.copies?.facade.constraints).toContainEqual({ key: 'dc_ac_ratio', value: 1.2 });
  });

  it('leaves the values as they are for a product neither stored nor in the catalogue', () => {
    const values = { constraints: ownValues };
    expect(withProductValue(values, 'gone', 'losses', 0.2, 'pv_supply', [facade])).toBe(values);
  });
});

describe('withValues', () => {
  it('puts the stored values in place of the defaults and keeps the rest', () => {
    const product = withValues(facade, [{ key: 'cost_energy_cap', value: 950 }, { key: 'arrays', value: [] }]);

    expect(product.constraints.find((c) => c.key === 'cost_energy_cap')?.default_value).toBe(950);
    expect(product.constraints.find((c) => c.key === 'module_power_kwp')?.default_value).toBe(0.4);
    expect(product.constraints).toHaveLength(facade.constraints.length);
  });
});
