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

import { Building3DView } from '@thd-spatial-ai/building-configurator';

import { configuratorServices } from './heatClient';
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

const PanelBody: FC<{ osmId: string; onExit: () => void }> = ({ osmId, onExit }) => {
  const { building, loading, error, objectId, country } = useBuildingState(osmId);
  const { geometry, error: geometryError } = useBuildingGeometry(objectId, country);

  if (loading) return <Notice>Loading this building…</Notice>;
  if (error) return <Notice>{error}</Notice>;
  if (!building) return null;

  // A geometry failure is reported rather than passed on as null, which the
  // view reads as still loading and would leave spinning for good.
  if (geometryError) return <Notice>{geometryError}</Notice>;

  return (
    <Building3DView
      building={building}
      geometry={geometry}
      onExit={onExit}
      services={configuratorServices}
    />
  );
};

export const BuildingPanelHost: FC = () => {
  const { buildingId, isOpen, close } = useConfiguratorParams();

  if (!isOpen || buildingId === null) return null;

  // Building3DView's root is `fixed inset-0 z-20`: left alone it renders
  // beneath the top bar and sidebar rail (z-[51]) and loses its header, which
  // holds the back button. Forcing the child to `absolute` makes its inset-0
  // resolve against this element, so the chrome stays usable. This reaches into
  // the package's positioning and must follow it if its root element changes.
  return (
    <div className="bg-background fixed right-0 bottom-0 z-[60] top-[var(--topbar-height)] left-[var(--sidebar-width)] [&>div]:!absolute">
      <PanelBody osmId={buildingId} onExit={close} />
    </div>
  );
};
