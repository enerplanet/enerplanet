/**
 * Puts the building configurator on screen for whichever building the URL
 * names: the package's 3D view, with the building's envelope in the middle and
 * its parameters beside it.
 *
 * The view draws its own chrome and handles Escape itself (an open surface
 * editor first, the building second), so there is no backdrop or key listener
 * here.
 */

import { useMemo, type FC, type ReactNode } from 'react';

import { useTranslation } from '@spatialhub/i18n';
import { Building3DView, isEnvelopeDetached, type BuildingState } from '@thd-spatial-ai/building-configurator';

import { config } from '@/configuration/app';
import { useModelStore } from '@/features/configurator/store/modelStore';
import { useConfirm } from '@/hooks/useConfirmDialog';

import { CHANGE_STATEMENT_URL, TABULA_DATASET_ID, type DatasetCredit } from './credits';
import { configuratorServicesFor } from './heatClient';
import { modelRunContext } from './runContext';
import { toStoredBuem, type StoredBuem } from './storedBuem';
import { usePreparationStepText } from './useAreaPreparation';
import { useBuildingGeometry } from './useBuildingGeometry';
import { useBuildingState } from './useBuildingState';
import { useDemandProfile } from './useDemandProfile';
import { useConfiguratorParams } from './useConfiguratorParams';

/**
 * Centred message for the states where there is no view to show. The view's
 * own header holds the back button, so each message carries one instead.
 */
const Notice: FC<{ children: ReactNode; onBack: () => void }> = ({ children, onBack }) => {
  const { t } = useTranslation();
  return (
    <div className="inset-0 flex h-full items-center justify-center">
      <div className="bg-card text-muted-foreground flex flex-col items-center gap-4 rounded-lg px-6 py-5 text-sm shadow-2xl">
        <p className="max-w-md text-center">{children}</p>
        <button
          type="button"
          onClick={onBack}
          className="bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm font-medium hover:opacity-90"
        >
          {t('buildingConfig.backToMap')}
        </button>
      </div>
    </div>
  );
};

/** Receives a building the user changed, as the model should store it. */
export type OnBuildingEdited = (osmId: string, buem: StoredBuem) => void;

/** Receives a building whose saved edits the user chose to discard. */
export type OnBuildingReset = (osmId: string) => void;

/**
 * Offered over the view when the building's saved edits match none of its
 * current surfaces, which the view then cannot draw. Saving again would keep
 * the old element ids, so the only way back to a 3D view is to start over.
 */
const ResetNotice: FC<{ onReset: () => void }> = ({ onReset }) => {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const reset = () => confirm({
    type: 'warning',
    title: t('buildingConfig.reset.confirmTitle'),
    description: t('buildingConfig.reset.confirmDescription'),
    confirmLabel: t('buildingConfig.reset.action'),
    onConfirm: async () => onReset(),
  });
  return (
    <div className="bg-card pointer-events-auto absolute top-16 left-1/2 z-40 flex w-max max-w-xl -translate-x-1/2 items-center gap-3 rounded-lg px-4 py-3 text-sm shadow-lg">
      <p className="text-muted-foreground">{t('buildingConfig.reset.notice')}</p>
      <button
        type="button"
        onClick={reset}
        className="bg-primary text-primary-foreground shrink-0 rounded-md px-3 py-1.5 text-sm font-medium hover:opacity-90"
      >
        {t('buildingConfig.reset.action')}
      </button>
    </div>
  );
};

/** The licence credits of the building's 3D dataset and TABULA type, for the view's attribution corner. */
const Credits: FC<{ credits: DatasetCredit[] }> = ({ credits }) => {
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

interface PanelBodyProps {
  osmId: string;
  /** A saved model's id; without it the building belongs to the draft. */
  modelId: number | undefined;
  /** Whose stored results the runs belong to: "models/<id>" or "drafts/<id>". */
  ownerPath: string;
  onExit: () => void;
  onEdited?: OnBuildingEdited;
  onReset?: OnBuildingReset;
}

const PanelBody: FC<PanelBodyProps> = ({ osmId, modelId, ownerPath, onExit, onEdited, onReset }) => {
  const { building, loading, error, preparing, objectId, country, credits, edited } = useBuildingState(osmId);
  const { geometry, error: geometryError } = useBuildingGeometry(objectId, country);
  const [demandProfile, setDemandProfile] = useDemandProfile(modelId, osmId);
  const services = useMemo(() => configuratorServicesFor(ownerPath, setDemandProfile), [ownerPath, setDemandProfile]);
  const fromDate = useModelStore((s) => s.fromDate);
  const toDate = useModelStore((s) => s.toDate);
  const { t } = useTranslation();
  const preparationStep = usePreparationStepText();

  if (preparing) {
    return (
      <Notice onBack={onExit}>
        {t('buildingConfig.preparing')}
        {preparationStep && <span className="text-foreground mt-2 block font-medium">{preparationStep}</span>}
      </Notice>
    );
  }
  if (loading) return <Notice onBack={onExit}>{t('buildingConfig.loading')}</Notice>;
  if (error) return <Notice onBack={onExit}>{error}</Notice>;
  if (!building) return null;
  if (!objectId) return <Notice onBack={onExit}>{t('buildingConfig.noGeometry')}</Notice>;

  // The view hands back the building it was given when nothing changed, and a
  // new object when something did.
  const exit = (edited: BuildingState | undefined) => {
    if (edited && edited !== building) onEdited?.(osmId, toStoredBuem(edited));
    onExit();
  };

  // A geometry failure is reported rather than passed on as null, which the
  // view reads as still loading and would leave spinning for good.
  if (geometryError) return <Notice onBack={onExit}>{geometryError}</Notice>;

  const detached = edited && geometry !== null
    && isEnvelopeDetached(geometry.surfaces, new Set(Object.keys(building.envelope)));
  // Only a saved model's building with stored series has a CSV to download.
  const seriesCsvUrl = modelId && demandProfile
    ? `${config.api.baseUrl}/models/${modelId}/buildings/${encodeURIComponent(osmId)}/series.csv`
    : undefined;

  return (
    <>
      <Building3DView
        building={building}
        geometry={geometry}
        onExit={exit}
        services={services}
        runContext={modelRunContext(fromDate, toDate)}
        demandProfile={demandProfile}
        seriesCsvUrl={seriesCsvUrl}
        attribution={credits.length > 0 ? <Credits credits={credits} /> : undefined}
      />
      {detached && onReset && <ResetNotice onReset={() => onReset(osmId)} />}
    </>
  );
};

interface BuildingPanelHostProps {
  /** The saved model the building belongs to; absent for a model not saved yet. */
  modelId?: number;
  /** The unsaved model's draft id, used when there is no modelId. */
  draftId?: string;
  onBuildingEdited?: OnBuildingEdited;
  onBuildingReset?: OnBuildingReset;
}

export const BuildingPanelHost: FC<BuildingPanelHostProps> = ({ modelId, draftId, onBuildingEdited, onBuildingReset }) => {
  const { buildingId, isOpen, close } = useConfiguratorParams();

  if (!isOpen || buildingId === null) return null;
  const ownerPath = modelId ? `models/${modelId}` : draftId ? `drafts/${draftId}` : null;
  if (!ownerPath) return null;

  // Building3DView's root (`fixed inset-0`) is forced to `absolute` here; follow the package if it changes.
  // z-50 matches Radix dialogs: appended to <body> later, they paint above the panel,
  // while the map's z-50 controls come earlier in the DOM and paint below it.
  return (
    <div className="bg-background fixed right-0 bottom-0 z-50 top-[var(--topbar-height)] left-[var(--sidebar-width)] [&>div]:!absolute">
      <PanelBody osmId={buildingId} modelId={modelId} ownerPath={ownerPath} onExit={close} onEdited={onBuildingEdited} onReset={onBuildingReset} />
    </div>
  );
};
