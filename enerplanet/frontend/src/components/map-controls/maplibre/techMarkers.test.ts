import { describe, expect, it } from 'vitest';

import { techMarkersOf } from './techMarkers';

const building = (osmId: string, techs: Record<string, unknown>) => ({
  type: 'Feature' as const,
  geometry: null as unknown as GeoJSON.Geometry,
  properties: { osm_id: osmId, techs },
});

describe('techMarkersOf', () => {
  it('marks storage and heat once each, and leaves PV and supply to other drawing', () => {
    const markers = techMarkersOf({
      type: 'FeatureCollection',
      features: [
        building('1', { pv_supply: {}, battery_storage: {}, gas_boiler: {}, air_source_heat_pump: {} }),
        building('2', { pv_supply: {}, gas_supply: {} }),
        building('3', { electric_boilers: {} }),
      ],
    });
    expect([...markers]).toEqual([
      ['1', ['heat', 'storage']],
      ['3', ['heat']],
    ]);
  });
});
