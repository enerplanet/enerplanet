import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PV_MODULE, type SurfacePolygon } from '@thd-spatial-ai/building-configurator';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/axios', () => ({ default: { get } }));

import { arrayWithLayout, bestFitArrays, fetchBestFitArrays } from './pvBestFit';
import type { PvSurfaceRow } from './usePvMode';

const flat = (id: string, w: number, d: number): SurfacePolygon => ({
  id,
  type: 'RoofSurface',
  coordinates: [[[0, 0, 5], [w, 0, 5], [w, d, 5], [0, d, 5], [0, 0, 5]]],
});

const row = (id: string, qualifies: boolean): PvSurfaceRow => ({
  surface_id: id, tilt: 15, azimuth: 180, area: 60, usable_share: 0.8, kind: 'roof', qualifies, suggested: qualifies,
});

describe('bestFitArrays', () => {
  it('lays out whole modules on qualifying roofs and skips those too small for one', () => {
    const arrays = bestFitArrays([row('big', true), row('tiny', true), row('wall', false)], [flat('big', 10, 6), flat('tiny', 1, 1)], 0.8, DEFAULT_PV_MODULE);
    expect(arrays.map((a) => a.surface_id)).toEqual(['big']);
    const [big] = arrays;
    expect(big.modules).toBeGreaterThan(0);
    expect(big.capacity_kw).toBeCloseTo(big.modules! * DEFAULT_PV_MODULE.kwp, 3);
    // A flat roof is racked at the configurator's default, facing south.
    expect(big.tilt).toBe(15);
    expect(big.azimuth).toBe(180);
    expect(big.usable_share).toBe(0.8);
  });
});

describe('arrayWithLayout', () => {
  it('keeps an array without a polygon as stored, for the backend to size by area', () => {
    const array = { surface_id: 'elsewhere', tilt: 30, azimuth: 200, area: 40, usable_share: 0.8 };
    expect(arrayWithLayout(array, undefined, DEFAULT_PV_MODULE)).toBe(array);
  });
});

describe('fetchBestFitArrays', () => {
  beforeEach(() => get.mockReset());

  it('lays out the qualifying roofs on the geometry of their 3D building, in the resolved country', async () => {
    get
      .mockResolvedValueOnce({ data: { country: 'germany', surfaces: [{ ...row('big', true), object_id: 'DE.A' }, { ...row('wall', false), object_id: 'DE.B' }] } })
      .mockResolvedValueOnce({ data: { buildings: [{ object_id: 'DE.A', surfaces: [{ id: 'big', type: 'RoofSurface', geojson: { type: 'Polygon', coordinates: flat('big', 10, 6).coordinates } }] }] } });

    const { country, arrays } = await fetchBestFitArrays('42', { lon: 12.9, lat: 48.8 }, 0.6, DEFAULT_PV_MODULE);

    expect(country).toBe('germany');
    expect(arrays.map((a) => [a.surface_id, a.usable_share])).toEqual([['big', 0.6]]);
    expect(arrays[0].modules).toBeGreaterThan(0);
    // Only the 3D building behind a qualifying roof is fetched.
    expect(get).toHaveBeenCalledWith('/v1/city2tabula/geometry', { params: { country: 'germany', object_ids: 'DE.A' } });
    expect(get).toHaveBeenCalledTimes(2);
  });
});
