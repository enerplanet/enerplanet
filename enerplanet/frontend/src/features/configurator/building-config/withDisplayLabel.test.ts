import { describe, expect, it } from 'vitest';
import type { BuildingState } from '@thd-spatial-ai/building-configurator';
import { withDisplayLabel } from './useBuildingState';

const building = (label: string) =>
  ({ identity: { id: label, label }, thematic: { identity: { id: label, label } } }) as unknown as BuildingState;

describe('withDisplayLabel', () => {
  it('labels a 3D building by its dataset id, not its c2t: key', () => {
    const shown = withDisplayLabel(building('c2t:DEBY_LOD2_107523689'), 'c2t:DEBY_LOD2_107523689');
    expect(shown.identity.label).toBe('DEBY_LOD2_107523689');
    expect(shown.thematic.identity.label).toBe('DEBY_LOD2_107523689');
    expect(shown.identity.id).toBe('c2t:DEBY_LOD2_107523689');
  });

  it('keeps the label of a building keyed by its OSM way', () => {
    const b = building('240054621');
    expect(withDisplayLabel(b, '240054621')).toBe(b);
  });
});
