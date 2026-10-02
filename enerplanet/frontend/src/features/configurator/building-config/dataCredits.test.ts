import { describe, expect, it } from 'vitest';

import { creditFor } from './dataCredits';

describe('creditFor', () => {
  it('returns the credit for each fixture country City2TABULA resolves', () => {
    expect(creditFor('netherlands')?.text).toBe('© 3DBAG by tudelft3d and 3DGI');
    expect(creditFor('germany')?.text).toBe('Quellenvermerk: Landesamt GeoInformation Bremen');
    expect(creditFor('austria')?.text).toBe('Datenquelle: Stadt Wien – data.wien.gv.at');
    expect(creditFor('czechia')?.text).toBe('Data o 3D modelu budov byla získána pod licencí CC BY z data.brno.cz.');
  });

  it('ignores case', () => {
    expect(creditFor('Czechia')).toEqual(creditFor('czechia'));
  });

  it('returns null for an unknown or missing country', () => {
    expect(creditFor('france')).toBeNull();
    expect(creditFor(null)).toBeNull();
    expect(creditFor('')).toBeNull();
  });
});
