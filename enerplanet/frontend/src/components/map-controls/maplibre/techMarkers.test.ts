import { describe, expect, it } from 'vitest';

import { techMarkersOf } from './techMarkers';

const building = (osmId: string, techs: Record<string, unknown>) => ({
  type: 'Feature' as const,
  geometry: null as unknown as GeoJSON.Geometry,
  properties: { osm_id: osmId, techs },
});

const PV = 'solar-panel';

describe('techMarkersOf', () => {
  it('gives each technology the 2D map draws its icon and legend group', () => {
    const markers = techMarkersOf({
      type: 'FeatureCollection',
      features: [
        building('1', { pv_supply: { icon: PV }, battery_storage: { icon: 'battery' }, gas_boiler: { icon: 'flame' } }),
        building('2', { gas_supply: { icon: 'flame' } }),
        building('3', { pv_supply: { icon: PV, arrays: [] } }),
      ],
    });
    expect([...markers]).toEqual([
      ['1', [{ icon: PV, mark: 'pv' }, { icon: 'battery', mark: 'storage' }, { icon: 'flame', mark: 'heat' }]],
      ['2', [{ icon: 'flame', mark: undefined }]],
    ]);
  });
});
