import { describe, it, expect } from 'vitest';
import { capabilitiesFrom, LEAST_CAPABLE } from './resultCapabilities';

// The gate must default to the LEAST capable set: an absent or partial
// capabilities block must never un-hide a section (a stale backend would
// otherwise render data that does not exist).
describe('capabilitiesFrom', () => {
  it('claims nothing when the response has no capabilities block', () => {
    expect(capabilitiesFrom(null)).toEqual(LEAST_CAPABLE);
    expect(capabilitiesFrom(undefined)).toEqual(LEAST_CAPABLE);
    expect(capabilitiesFrom({ locations: [] })).toEqual(LEAST_CAPABLE);
  });

  it('passes through a declared capability set', () => {
    const caps = capabilitiesFrom({
      locations: [],
      capabilities: { ...LEAST_CAPABLE, lineLoading: true, utilizationOnly: true },
    });
    expect(caps.lineLoading).toBe(true);
    expect(caps.utilizationOnly).toBe(true);
    expect(caps.voltage).toBe(false);
  });

  it('fills missing keys with the least-capable default', () => {
    const caps = capabilitiesFrom({
      locations: [],
      capabilities: { lineLoading: true } as never,
    });
    expect(caps.lineLoading).toBe(true);
    expect(caps.convergence).toBe(false);
    expect(caps.voltage).toBe(false);
  });
});