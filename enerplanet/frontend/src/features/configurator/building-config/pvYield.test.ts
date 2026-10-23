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
});
