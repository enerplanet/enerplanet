import { describe, expect, it } from 'vitest';

import { creditsFor, TABULA_DATASET_ID, type DatasetCredit } from './credits';

const credit = (dataset_id: string): DatasetCredit => ({
  dataset_id,
  provider: 'p',
  dataset: 'd',
  licence: 'CC-BY-4.0',
  licence_url: 'https://creativecommons.org/licenses/by/4.0/',
  credit: `credit of ${dataset_id}`,
  changes: 'derived',
});

const NL = 'nl-3dbag';
const DE = 'de-hb-lod2';

describe('creditsFor', () => {
  const attributions = [credit(NL), credit(TABULA_DATASET_ID), credit(DE)];

  it("returns the building's dataset credit, then TABULA's when it has a TABULA type", () => {
    expect(creditsFor(attributions, NL, true).map((c) => c.dataset_id)).toEqual([NL, TABULA_DATASET_ID]);
  });

  it("leaves TABULA out when the building has no TABULA type", () => {
    expect(creditsFor(attributions, DE, false).map((c) => c.dataset_id)).toEqual([DE]);
  });

  it('leaves out a dataset the attributions do not carry', () => {
    expect(creditsFor(attributions, 'at-wien-lod2', false)).toEqual([]);
    expect(creditsFor(undefined, NL, true)).toEqual([]);
    expect(creditsFor(attributions, null, false)).toEqual([]);
  });
});
