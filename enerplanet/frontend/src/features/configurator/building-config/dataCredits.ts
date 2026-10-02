/**
 * Source credit for the 3D building data shown in the configurator, by the
 * country City2TABULA resolved the building to.
 */

export interface DataCredit {
  /** Credit line as the provider requires it. */
  text: string;
  licence: string;
  url: string;
}

// Temporary: valid only while each country has exactly one 3D dataset, the
// fixture's. Replace with the attribution City2TABULA serves per building
// (THD-Spatial-AI/city2tabula#144).
const CREDITS: Record<string, DataCredit> = {
  netherlands: {
    text: '© 3DBAG by tudelft3d and 3DGI',
    licence: 'CC BY 4.0',
    url: 'https://docs.3dbag.nl/en/copyright/',
  },
  germany: {
    text: 'Quellenvermerk: Landesamt GeoInformation Bremen',
    licence: 'CC BY 4.0',
    url: 'https://www.metaver.de/trefferanzeige?docuuid=226971C2-6677-4B79-95F3-C5311F1275C8',
  },
  austria: {
    text: 'Datenquelle: Stadt Wien – data.wien.gv.at',
    licence: 'CC BY 4.0',
    url: 'https://digitales.wien.gv.at/ogd-nutzungsbedingungen/',
  },
  czechia: {
    text: 'Data o 3D modelu budov byla získána pod licencí CC BY z data.brno.cz.',
    licence: 'CC BY 4.0',
    url: 'https://data.brno.cz/data/licence/',
  },
};

/** What City2TABULA changes in every 3D dataset, as CC BY requires stating. */
export const CHANGE_STATEMENT =
  'City2TABULA derives building attributes (areas, heights, volume, storeys, TABULA type) from the geometry, ' +
  "merges a building's parts into one building, removes or clips faces shared between parts, " +
  'and omits buildings without wall or roof faces.';

/** City2TABULA's description of its processing, linked from the change statement. */
export const CHANGE_STATEMENT_URL = 'https://thd-spatial-ai.github.io/city2tabula/code/sql-pipeline/';

/** The credit for a country's 3D data, or null when none is known. */
export function creditFor(country: string | null): DataCredit | null {
  if (!country) return null;
  return CREDITS[country.toLowerCase()] ?? null;
}
