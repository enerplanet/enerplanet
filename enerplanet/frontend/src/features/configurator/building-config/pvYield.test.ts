import { describe, expect, it } from 'vitest';

import { pvYieldRequest } from './pvYield';

describe('pvYieldRequest', () => {
  it('takes geometry from the view and the usable share from the stored arrays', () => {
    const request = pvYieldRequest(
      { osm_id: '7', surfaces: [
        { id: 'south', area: 42, tilt: 30, azimuth: 175 },
        { id: 'flat', area: 100, tilt: 0, azimuth: 0 },
      ] },
      {
        location: [12.96, 48.83],
        pv: { alias: 'PV', losses: 0.1, module_type: 1, cost_energy_cap: 900, arrays: [
          { surface_id: 'south', tilt: 35, azimuth: 180, area: 40, usable_share: 0.5 },
        ] },
      },
    );

    expect(request).toEqual({
      osm_id: '7', lat: 48.83, lon: 12.96,
      module: { losses: 0.1, module_type: 1 },
      arrays: [
        { surface_id: 'south', tilt: 30, azimuth: 175, area: 42, usable_share: 0.5 },
        { surface_id: 'flat', tilt: 0, azimuth: 0, area: 100, usable_share: 0.8 },
      ],
    });
  });

  it('reads the module settings from the stored constraints, as a building tech keeps them', () => {
    const request = pvYieldRequest(
      { osm_id: '7', surfaces: [{ id: 'south', area: 42, tilt: 30, azimuth: 175 }] },
      {
        location: [12.96, 48.83],
        pv: { alias: 'PV', constraints: [
          { key: 'losses', value: 0.14 },
          { key: 'dc_ac_ratio', value: 1.2 },
          { key: 'inv_eff', value: 96 },
          { key: 'module_type', value: 0 },
          { key: 'cost_energy_cap', value: 575 },
        ] },
      },
    );

    expect(request.module).toEqual({ losses: 0.14, dc_ac_ratio: 1.2, inv_eff: 96, module_type: 0 });
  });
});
