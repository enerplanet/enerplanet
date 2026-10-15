/**
 * Puts the building configurator on screen for whichever building the URL
 * names: the package's 3D view, with the building's envelope in the middle and
 * its parameters beside it.
 *
 * The view draws its own chrome and handles Escape itself (an open surface
 * editor first, the building second), so there is no backdrop or key listener
 * here.
 */

import type { FC } from 'react';

import { Building3DView, type BuildingState } from '@thd-spatial-ai/building-configurator';

import { useModelStore } from '@/features/configurator/store/modelStore';

import { CHANGE_STATEMENT_URL, TABULA_DATASET_ID } from './credits';
import { configuratorServices } from './heatClient';
import { modelRunContext } from './runContext';
import { toStoredBuem, type StoredBuem } from './storedBuem';
import { useBuildingGeometry } from './useBuildingGeometry';
import { useBuildingState } from './useBuildingState';
import { useConfiguratorParams } from './useConfiguratorParams';

/**
 * Centred message for the states where there is no view to show. The view's
 * own header holds the back button, so each message carries one instead.
 */
const Notice: FC<{ children: string; onBack: () => void }> = ({ children, onBack }) => (
  <div className="inset-0 flex h-full items-center justify-center">
    <div className="bg-card text-muted-foreground flex flex-col items-center gap-4 rounded-lg px-6 py-5 text-sm shadow-2xl">
      <p>{children}</p>
      <button
        type="button"
        onClick={onBack}
        className="bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm font-medium hover:opacity-90"
      >
        Back to map
      </button>
    </div>
  </div>
);

/** Receives a building the user changed, as the model should store it. */
export type OnBuildingEdited = (osmId: string, buem: StoredBuem) => void;

const PanelBody: FC<{ osmId: string; onExit: () => void; onEdited?: OnBuildingEdited }> = ({ osmId, onExit, onEdited }) => {
  const { building, loading, error, objectId, country, credits } = useBuildingState(osmId);
  const { geometry, error: geometryError } = useBuildingGeometry(objectId, country);
  const fromDate = useModelStore((s) => s.fromDate);
  const toDate = useModelStore((s) => s.toDate);

  if (loading) return <Notice onBack={onExit}>Loading this building…</Notice>;
  if (error) return <Notice onBack={onExit}>{error}</Notice>;
  if (!building) return null;
  if (!objectId) return <Notice onBack={onExit}>City2TABULA no longer holds this building's 3D geometry.</Notice>;

  // The view hands back the building it was given when nothing changed, and a
  // new object when something did.
  const exit = (edited: BuildingState | undefined) => {
    if (edited && edited !== building) onEdited?.(osmId, toStoredBuem(edited));
    onExit();
  };

  // A geometry failure is reported rather than passed on as null, which the
  // view reads as still loading and would leave spinning for good.
  if (geometryError) return <Notice onBack={onExit}>{geometryError}</Notice>;

  return (
    <>
      <Building3DView
        building={building}
        geometry={geometry}
        onExit={exit}
        services={configuratorServices}
        runContext={modelRunContext(fromDate, toDate)}
      />
      {credits.length > 0 && (
        <div className="bg-card/80 text-muted-foreground pointer-events-auto absolute bottom-2 left-1/2 z-30 -translate-x-1/2 rounded px-2 py-0.5 text-[11px]">
          {credits.map((c) => {
            const isTabula = c.dataset_id === TABULA_DATASET_ID;
            return (
              <div key={c.dataset_id}>
                {isTabula ? 'Building type' : '3D data'}:{' '}
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
                      modified by City2TABULA
                    </a>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
};

export const BuildingPanelHost: FC<{ onBuildingEdited?: OnBuildingEdited }> = ({ onBuildingEdited }) => {
  const { buildingId, isOpen, close } = useConfiguratorParams();

  if (!isOpen || buildingId === null) return null;

  // Building3DView's root (`fixed inset-0`) is forced to `absolute` here; follow the package if it changes.
  // z-50 matches Radix dialogs: appended to <body> later, they paint above the panel,
  // while the map's z-50 controls come earlier in the DOM and paint below it.
  return (
    <div className="bg-background fixed right-0 bottom-0 z-50 top-[var(--topbar-height)] left-[var(--sidebar-width)] [&>div]:!absolute">
      <PanelBody osmId={buildingId} onExit={close} onEdited={onBuildingEdited} />
    </div>
  );
};
