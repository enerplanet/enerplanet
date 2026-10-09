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

import { CHANGE_STATEMENT_URL, TABULA_DATASET_ID } from './credits';
import { configuratorServices } from './heatClient';
import { toStoredBuem, type StoredBuem } from './storedBuem';
import { useBuildingGeometry } from './useBuildingGeometry';
import { useBuildingState } from './useBuildingState';
import { useConfiguratorParams } from './useConfiguratorParams';

/** Centred message for the states where there is no view to show yet. */
const Notice: FC<{ children: string }> = ({ children }) => (
  <div className="flex h-full items-center justify-center">
    <div className="bg-card text-muted-foreground rounded-lg px-6 py-5 text-sm shadow-2xl">
      {children}
    </div>
  </div>
);

/** Receives a building the user changed, as the model should store it. */
export type OnBuildingEdited = (osmId: string, buem: StoredBuem) => void;

const PanelBody: FC<{ osmId: string; onExit: () => void; onEdited?: OnBuildingEdited }> = ({ osmId, onExit, onEdited }) => {
  const { building, loading, error, objectId, country, credits } = useBuildingState(osmId);
  const { geometry, error: geometryError } = useBuildingGeometry(objectId, country);

  if (loading) return <Notice>Loading this building…</Notice>;
  if (error) return <Notice>{error}</Notice>;
  if (!building) return null;
  if (!objectId) return <Notice>City2TABULA no longer holds this building's 3D geometry.</Notice>;

  // The view hands back the building it was given when nothing changed, and a
  // new object when something did.
  const exit = (edited: BuildingState | undefined) => {
    if (edited && edited !== building) onEdited?.(osmId, toStoredBuem(edited));
    onExit();
  };

  // A geometry failure is reported rather than passed on as null, which the
  // view reads as still loading and would leave spinning for good.
  if (geometryError) return <Notice>{geometryError}</Notice>;

  return (
    <>
      <Building3DView
        building={building}
        geometry={geometry}
        onExit={exit}
        services={configuratorServices}
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

  // Building3DView's root is `fixed inset-0 z-20`: left alone it renders
  // beneath the top bar and sidebar rail (z-[51]) and loses its header, which
  // holds the back button. Forcing the child to `absolute` makes its inset-0
  // resolve against this element, so the chrome stays usable. This reaches into
  // the package's positioning and must follow it if its root element changes.
  return (
    <div className="bg-background fixed right-0 bottom-0 z-[60] top-[var(--topbar-height)] left-[var(--sidebar-width)] [&>div]:!absolute">
      <PanelBody osmId={buildingId} onExit={close} onEdited={onBuildingEdited} />
    </div>
  );
};
