import { describe, it, expect } from 'vitest';
import { yearToConstructionPeriod } from './buildingOptions';

describe('yearToConstructionPeriod', () => {
  it('maps a year to the TABULA period band it falls in, at the boundaries', () => {
    expect(yearToConstructionPeriod(1850)).toBe('Pre-1919');
    expect(yearToConstructionPeriod(1918)).toBe('Pre-1919');
    expect(yearToConstructionPeriod(1919)).toBe('1919-1948');
    expect(yearToConstructionPeriod(1948)).toBe('1919-1948');
    expect(yearToConstructionPeriod(1957)).toBe('1949-1957');
    expect(yearToConstructionPeriod(1968)).toBe('1958-1968');
    expect(yearToConstructionPeriod(1983)).toBe('1979-1983');
    expect(yearToConstructionPeriod(2009)).toBe('2002-2009');
    expect(yearToConstructionPeriod(2010)).toBe('Post-2010');
  });

  it('resolves every year, including ones outside the demo range', () => {
    expect(yearToConstructionPeriod(1700)).toBe('Pre-1919');
    expect(yearToConstructionPeriod(2100)).toBe('Post-2010');
  });
});
