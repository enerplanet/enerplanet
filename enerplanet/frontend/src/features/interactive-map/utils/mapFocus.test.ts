import { describe, expect, it } from 'vitest';
import { centreTarget, lonLatPoints } from './mapFocus';

const home = { latitude: 48.83, longitude: 12.96 };

describe('lonLatPoints', () => {
  it('flattens a GeoJSON MultiPolygon into its points', () => {
    const multi = [[[[8.42, 48.10], [8.43, 48.10], [8.43, 48.11], [8.42, 48.10]]]];
    expect(lonLatPoints(multi)).toEqual([[8.42, 48.10], [8.43, 48.10], [8.43, 48.11], [8.42, 48.10]]);
  });

  it('returns no points for a missing area', () => {
    expect(lonLatPoints(undefined)).toEqual([]);
    expect(lonLatPoints([])).toEqual([]);
  });
});

describe('centreTarget', () => {
  it('fits the model area when there is one', () => {
    const target = centreTarget([[8.42, 48.10], [8.43, 48.11]], home);
    expect(target).toEqual({ kind: 'area', extent: [8.42, 48.10, 8.43, 48.11] });
  });

  it('falls back to the saved location without an area', () => {
    expect(centreTarget([], home)).toEqual({ kind: 'location', lonLat: [12.96, 48.83] });
  });
});
