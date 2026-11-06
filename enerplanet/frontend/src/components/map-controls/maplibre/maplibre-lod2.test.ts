import { describe, expect, it } from 'vitest';

import * as maplibregl from 'maplibre-gl';
import * as THREE from 'three';

import { Lod2Layer, triangulatePlanar } from './maplibre-lod2';
import type { Lod2Surface } from './useLod2Surfaces';
import { addByOsmId, lod2SurfacesOf } from './useLod2Surfaces';
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
    const surfaces = lod2SurfacesOf({ object_id: 'B1', osm_ids: [], surfaces: [
      { id: 'r1', type: 'RoofSurface', geometry: { type: 'Polygon', coordinates: [ring] } },
      { id: 'w1', type: 'WallSurface', geometry: { type: 'MultiPolygon', coordinates: [[ring], [ring]] } },
      { id: 'g1', type: 'GroundSurface', geometry: { type: 'Polygon', coordinates: [ring] } },
    ] });
    expect(surfaces.map((s) => s.roof)).toEqual([true, false, false]);
    expect(surfaces.map((s) => s.id)).toEqual(['r1', 'w1', 'w1']);
  });
});

describe('addByOsmId', () => {
  const ring = [[0, 0, 1], [1, 0, 1], [1, 1, 2], [0, 0, 1]];
  const building = (object_id: string, osm_ids: string[]) => ({
    object_id, osm_ids, surfaces: [{ id: `${object_id}-r`, type: 'RoofSurface', geometry: { type: 'Polygon', coordinates: [ring] } }],
  });

  it('files each building once, under its first OSM way in the model', () => {
    const into = new Map();
    addByOsmId(into, [
      building('A', ['9', '1', '2']),
      building('B', ['1']),
      building('C', ['7']),
      building('D', []),
      building('E', []),
    ], new Set(['1', '2', 'c2t:E']));
    expect([...into.keys()]).toEqual(['1', 'c2t:E']);
    expect(into.get('1').map((s: { id: string }) => s.id)).toEqual(['A-r', 'B-r']);
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

describe('Lod2Layer.pick', () => {
  // Two flat roofs 10 m above a 10 m x 10 m footprint, the second about 50 m east of the first.
  const lng0 = 8.4233, lat0 = 48.1016, dLng = 50 / (111320 * Math.cos((lat0 * Math.PI) / 180));
  const box = (lng: number): Lod2Surface[] => {
    const d = 10 / 111320;
    const ground = [[lng, lat0, 300], [lng + d, lat0, 300]];
    const roof = [[lng, lat0, 310], [lng + d, lat0, 310], [lng + d, lat0 + d, 310], [lng, lat0 + d, 310], [lng, lat0, 310]];
    return [{ id: `${lng}-w`, roof: false, rings: [[...ground, [lng + d, lat0, 310], [lng, lat0, 310], ground[0]]] }, { id: `${lng}-r`, roof: true, rings: [roof] }];
  };

  /** A layer viewed from 200 m straight above the first building's roof centre. */
  const layerFromAbove = () => {
    const layer = new Lod2Layer();
    layer.setBuildings(new Map([['a', box(lng0)], ['b', box(lng0 + dLng)]]));
    const origin = maplibregl.MercatorCoordinate.fromLngLat([lng0, lat0], 0);
    const metre = origin.meterInMercatorCoordinateUnits();
    const toMercator = new THREE.Matrix4().makeTranslation(origin.x, origin.y, 0).scale(new THREE.Vector3(metre, -metre, metre));
    const camera = new THREE.PerspectiveCamera(30, 1, 1, 1000);
    camera.position.set(5, 5, 200);
    camera.updateMatrixWorld();
    const view = camera.projectionMatrix.clone().multiply(camera.matrixWorldInverse);
    const mainMatrix = view.multiply(toMercator.invert()).toArray();
    layer.render(null as never, { defaultProjectionData: { mainMatrix } } as never);
    return { layer, view: camera.projectionMatrix.clone().multiply(camera.matrixWorldInverse) };
  };

  it('finds the building drawn under a point and nothing beside them', () => {
    const { layer, view } = layerFromAbove();
    expect(layer.pick(0, 0)).toBe('a');
    const b = new THREE.Vector3(55, 5, 10).applyMatrix4(view);
    expect(layer.pick(b.x, b.y)).toBe('b');
    const between = new THREE.Vector3(30, 5, 10).applyMatrix4(view);
    expect(layer.pick(between.x, between.y)).toBeNull();
  });
});
