/**
 * Source credits for the data the configurator shows, as City2TABULA returns
 * them next to each building through the backend's enrich endpoint.
 */

/** One source dataset's credit. */
export interface DatasetCredit {
  dataset_id: string;
  provider: string;
  dataset: string;
  /** SPDX identifier or LicenseRef. */
  licence: string;
  licence_url: string;
  /** Credit line as the provider requires it. */
  credit: string;
  credit_url?: string;
  terms_url?: string;
  /** What City2TABULA changed in the source data. */
  changes: string;
}

/** City2TABULA's dataset id for the TABULA building typology. */
export const TABULA_DATASET_ID = 'tabula-episcope';

/** City2TABULA's description of its processing, linked from the 3D credit. */
export const CHANGE_STATEMENT_URL = 'https://thd-spatial-ai.github.io/city2tabula/code/sql-pipeline/';

/**
 * The credits a building's data needs: its 3D dataset's, then TABULA's when
 * the building carries a TABULA type. A dataset missing from attributions is
 * left out rather than guessed.
 */
export function creditsFor(
  attributions: DatasetCredit[] | undefined,
  datasetId: string | null,
  hasTabulaType: boolean,
): DatasetCredit[] {
  const byId = new Map((attributions ?? []).map((a) => [a.dataset_id, a]));
  const ids = [datasetId, hasTabulaType ? TABULA_DATASET_ID : null];
  return ids.flatMap((id) => {
    const credit = id ? byId.get(id) : undefined;
    return credit ? [credit] : [];
  });
}
