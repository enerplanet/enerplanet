import type { FC } from 'react';

import { useTranslation } from '@spatialhub/i18n';

import { CHANGE_STATEMENT_URL, TABULA_DATASET_ID, type DatasetCredit } from './credits';

/** Licence credits of 3D datasets and of TABULA types, one line each, for a view's attribution corner. */
export const Credits: FC<{ credits: DatasetCredit[] }> = ({ credits }) => {
  const { t } = useTranslation();
  return (
    <>
      {credits.map((c) => {
        const isTabula = c.dataset_id === TABULA_DATASET_ID;
        return (
          <div key={c.dataset_id}>
            {isTabula ? t('tooltips.buildingType.title') : t('buildingConfig.credit3dData')}:{' '}
            <a
              href={c.credit_url ?? c.terms_url ?? c.licence_url}
              title={isTabula ? c.changes : undefined}
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              {c.credit}
            </a>
            , {c.licence}
            {!isTabula && (
              <>
                ,{' '}
                <a
                  href={CHANGE_STATEMENT_URL}
                  title={c.changes}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline decoration-dotted"
                >
                  {t('buildingConfig.modifiedBy', { name: 'City2TABULA' })}
                </a>
              </>
            )}
          </div>
        );
      })}
    </>
  );
};
