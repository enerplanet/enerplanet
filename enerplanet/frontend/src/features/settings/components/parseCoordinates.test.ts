import { describe, it, expect } from 'vitest';
import { parseCoordinates } from './LocationSearch';

describe('parseCoordinates', () => {
  it('reads "lat, lon" with any of the separators', () => {
    for (const query of ['48.83, 12.96', '48.83,12.96', '48.83; 12.96', ' 48.83 12.96 ']) {
      expect(parseCoordinates(query)).toMatchObject({ latitude: 48.83, longitude: 12.96, name: '48.8300, 12.9600' });
    }
  });

  it('reads negative coordinates', () => {
    expect(parseCoordinates('-33.9, -70.65')).toMatchObject({ latitude: -33.9, longitude: -70.65 });
  });

  it('rejects place names and values outside the globe', () => {
    expect(parseCoordinates('Deggendorf')).toBeNull();
    expect(parseCoordinates('48.83')).toBeNull();
    expect(parseCoordinates('91, 12')).toBeNull();
    expect(parseCoordinates('48, 181')).toBeNull();
  });
});
