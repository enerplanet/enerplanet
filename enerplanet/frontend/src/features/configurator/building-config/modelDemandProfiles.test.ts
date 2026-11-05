import { afterEach, describe, expect, it, vi } from 'vitest';

const get = vi.fn();
vi.mock('@/lib/axios', () => ({ default: { get } }));

const { analysisProgress, buemTotals, pollDemandProfiles } = await import('./modelDemandProfiles');

const answer = (status: string, extra = {}) => ({
  data: { status, total: 10, resolved: 0, pending: 10, failed: 0, shared: 0, not_heated: 0, computed: 0, buildings: [], ...extra },
});

describe('buemTotals', () => {
  it('adds heating, electricity, cooling and hot water, and keeps kitchen gas apart', () => {
    // Building c2t:DEBY_LOD2_107523689 as the configurator shows it: 218,239 kWh in total.
    const totals = buemTotals({
      osm_id: 'c2t:DEBY_LOD2_107523689',
      status: 'resolved',
      heating_kwh_a: 153456,
      electricity_kwh_a: 23032,
      cooling_kwh_a: 41751,
      hot_water_kwh_a: 0,
      kitchen_kwh_a: 120,
    });
    expect(totals).toEqual({ total: 218239, heating: 153456, electricity: 23032, cooling: 41751, hotWater: 0, kitchenGas: 120 });
  });

  it('counts a missing carrier as zero', () => {
    expect(buemTotals({ osm_id: '1', status: 'resolved', heating_kwh_a: 100 })?.total).toBe(100);
  });

  it('has no totals for a building that is not resolved', () => {
    expect(buemTotals({ osm_id: '1', status: 'failed', error_message: 'no envelope' })).toBeNull();
    expect(buemTotals({ osm_id: '1', status: 'pending' })).toBeNull();
  });
});

describe('analysisProgress', () => {
  it('counts buildings whose BuEM result is in before the analysis links them', () => {
    const d = answer('resolving', { resolved: 0, pending: 8, shared: 2, computed: 5 }).data;
    expect(analysisProgress(d)).toEqual({ status: 'resolving', total: 10, done: 7, failed: 0 });
  });
});

describe('pollDemandProfiles', () => {
  afterEach(() => {
    vi.useRealTimers();
    get.mockReset();
  });

  it('keeps polling a running analysis after a failed read', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    get.mockResolvedValueOnce(answer('resolving'));
    get.mockRejectedValueOnce(new Error('network'));
    get.mockResolvedValueOnce(answer('completed'));
    const reads: string[] = [];

    pollDemandProfiles(9, (d) => reads.push(d.status));
    await vi.advanceTimersByTimeAsync(10_000);

    expect(get).toHaveBeenCalledTimes(3);
    expect(reads).toEqual(['resolving', 'completed']);
  });

  it('stops once stopped', async () => {
    vi.useFakeTimers();
    get.mockResolvedValue(answer('resolving'));

    const stop = pollDemandProfiles(9, () => {});
    await vi.advanceTimersByTimeAsync(0);
    stop();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(get).toHaveBeenCalledTimes(1);
  });
});
