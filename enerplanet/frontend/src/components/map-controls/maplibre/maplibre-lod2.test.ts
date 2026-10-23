import { describe, expect, it } from 'vitest';

import { triangulatePlanar } from './maplibre-lod2';
import { lod2SurfacesOf } from './useLod2Surfaces';
import { pvBuildingsOf } from './usePvSurfaceIds';

const area = (tris: number[][]) => {
  let total = 0;
  for (let i = 0; i < tris.length; i += 3) {
    const [a, b, c] = [tris[i], tris[i + 1], tris[i + 2]];
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    total += Math.hypot(n[0], n[1], n[2]) / 2;
  }
  return total;
};

describe('triangulatePlanar', () => {
  it('covers a sloped roof and a vertical wall with triangles of their own area', () => {
    // 10 m x 10 m in plan, rising 5 m: a slope of 10 x sqrt(125) m.
    const roof = triangulatePlanar([[[0, 0, 0], [10, 0, 0], [10, 10, 5], [0, 10, 5], [0, 0, 0]]]);
    expect(roof).toHaveLength(6);
    expect(area(roof)).toBeCloseTo(10 * Math.sqrt(125), 6);

    const wall = triangulatePlanar([[[0, 0, 0], [8, 0, 0], [8, 0, 3], [0, 0, 3], [0, 0, 0]]]);
    expect(area(wall)).toBeCloseTo(24, 6);
  });
});

describe('lod2SurfacesOf', () => {
  it('keeps roofs and walls and leaves ground surfaces out', () => {
    const ring = [[12.96, 48.83, 320], [12.97, 48.83, 320], [12.97, 48.84, 325], [12.96, 48.83, 320]];
    const surfaces = lod2SurfacesOf({ buildings: [{ surfaces: [
      { id: 'r1', type: 'RoofSurface', geojson: { type: 'Polygon', coordinates: [ring] } },
      { id: 'w1', type: 'WallSurface', geojson: { type: 'MultiPolygon', coordinates: [[ring], [ring]] } },
      { type: 'GroundSurface', geojson: { type: 'Polygon', coordinates: [ring] } },
    ] }] });
    expect(surfaces.map((s) => s.roof)).toEqual([true, false, false]);
    expect(surfaces.map((s) => s.id)).toEqual(['r1', 'w1', 'w1']);
  });
});

describe('pvBuildingsOf', () => {
  const building = (osm_id: string, techs?: unknown): GeoJSON.Feature => ({ type: 'Feature', geometry: null as never, properties: { osm_id, techs } });
  const buildings: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [
    building('1', { pv_supply: { arrays: [{ surface_id: 'r1' }, { surface_id: 'r2' }] } }),
    building('2', { pv_supply: { alias: 'PV' } }),
    building('3', { battery_storage: {} }),
    building('4'),
  ] };

  it('lists stored arrays, and null for automatic placement', () => {
    expect(pvBuildingsOf(buildings)).toEqual([['1', ['r1', 'r2']], ['2', null]]);
  });

  it('reads techs from techsFor when given, not from the property', () => {
    const techsFor = (osmId: string) => (osmId === '4' ? { pv_supply: { arrays: [{ surface_id: 'r9' } as never] } } : null);
    expect(pvBuildingsOf(buildings, techsFor)).toEqual([['4', ['r9']]]);
  });
});
