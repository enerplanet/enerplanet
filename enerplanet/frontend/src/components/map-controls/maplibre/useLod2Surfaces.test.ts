import { describe, expect, it, vi } from 'vitest';

const get = vi.fn();
vi.mock('@/lib/axios', () => ({ default: { get } }));

const { fetchArea } = await import('./useLod2Surfaces');

const credit = (dataset_id: string) => ({
  dataset_id, provider: 'p', dataset: 'd', licence: 'CC-BY-4.0', licence_url: 'u', credit: dataset_id, changes: 'c',
});

describe('fetchArea', () => {
  it('lists each dataset credit once across pages', async () => {
    get
      .mockResolvedValueOnce({ data: { country: 'germany', buildings: [], attributions: [credit('by-lod2')], next_cursor: 'n' } })
      .mockResolvedValueOnce({ data: { country: 'germany', buildings: [], attributions: [credit('by-lod2'), credit('nrw-lod2')], next_cursor: null } });

    const area = await fetchArea({ xmin: 0, ymin: 0, xmax: 1, ymax: 1 }, new Set());

    expect(area.credits.map((c) => c.dataset_id)).toEqual(['by-lod2', 'nrw-lod2']);
  });
});
