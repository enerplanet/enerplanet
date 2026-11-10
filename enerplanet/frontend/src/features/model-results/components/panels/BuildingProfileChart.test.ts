import { describe, expect, it } from 'vitest';
import { firstSeason } from './BuildingProfileChart';

describe('firstSeason', () => {
  it('opens on the first season with an hour in the run', () => {
    expect(firstSeason(['2023-01-15T00:00:00Z', '2023-07-01T00:00:00Z'])).toBe('winter');
    expect(firstSeason(['2023-06-01T00:00:00Z', '2023-08-31T23:00:00Z'])).toBe('summer');
    expect(firstSeason(['2023-04-01T00:00:00Z'])).toBe('year');
  });
});
