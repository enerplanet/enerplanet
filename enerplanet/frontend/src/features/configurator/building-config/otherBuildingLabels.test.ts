import { describe, expect, it } from 'vitest';

import { otherBuildingLabels, type PvSurfaceRow } from './usePvMode';

const t = (key: string, options?: Record<string, unknown>) => `${key} ${options?.n}/${options?.total}`;

const row = (surface_id: string, object_id: string | undefined, kind: 'roof' | 'wall' = 'roof'): PvSurfaceRow =>
  ({ surface_id, object_id, kind, tilt: 30, azimuth: 180, area: 40, usable_share: 0.8, qualifies: true, suggested: true });

describe('otherBuildingLabels', () => {
  it('numbers the other 3D buildings after the shown one and labels only their surfaces', () => {
    const labels = otherBuildingLabels(
      [row('a1', 'A'), row('b1', 'B'), row('c1', 'C', 'wall'), row('b2', 'B'), row('a2', 'A')],
      'A',
      t,
    );

    expect(labels).toEqual({
      b1: 'buildingConfig.pv.otherRoof 2/3',
      b2: 'buildingConfig.pv.otherRoof 2/3',
      c1: 'buildingConfig.pv.otherWall 3/3',
    });
  });

  it('labels nothing for a way with one 3D building or surfaces without a building', () => {
    expect(otherBuildingLabels([row('a1', 'A'), row('x', undefined)], 'A', t)).toEqual({});
  });
});
