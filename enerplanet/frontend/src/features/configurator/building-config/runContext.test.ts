import { describe, expect, it } from 'vitest';
import { modelRunContext } from './runContext';

describe('modelRunContext', () => {
  it('covers the model period from its first to its last hour', () => {
    expect(modelRunContext('2019-01-01', '2019-12-31')).toEqual({
      startDate: '2019-01-01T00:00:00Z',
      endDate: '2019-12-31T23:00:00Z',
    });
  });

  it('is undefined while the model has no period', () => {
    expect(modelRunContext('', '')).toBeUndefined();
    expect(modelRunContext('2019-01-01', '')).toBeUndefined();
  });
});
