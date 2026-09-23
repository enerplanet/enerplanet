/**
 * Puts the building configurator on screen for whichever building the URL
 * names.
 *
 * This branch mounts the experimental 3D view in place of the dialog
 * dashboard: full screen rather than a centred panel, and it draws its own
 * chrome, so there is no backdrop here. Escape is left to the view, which
 * closes an open surface editor first and the building second; a listener here
 * would collapse both on one press.
 *
 * The provider is mounted here rather than at the application root so the
 * package's clients are built only once a building is actually open.
 */

import type { FC } from 'react';

import { Button } from '@spatialhub/ui';
import { BuildingConfiguratorProvider } from '@thd-spatial-ai/building-configurator';
import { Building3DView } from '@thd-spatial-ai/building-configurator/experimental';

import { heatClient } from './heatClient';
import { useBuildingGeometry } from './useBuildingGeometry';
import { useBuildingState } from './useBuildingState';
import { useConfiguratorParams } from './useConfiguratorParams';

/**
 * Centred message for the states where there is no view to show yet. It
 * carries its own back button because the view's header, and its Escape
 * handling, are not on screen in these states.
 */
const Notice: FC<{ children: string; onExit: () => void }> = ({ children, onExit }) => (
  <div className="flex h-full items-center justify-center">
    <div className="bg-card text-muted-foreground flex flex-col items-center gap-4 rounded-lg px-6 py-5 text-sm shadow-2xl">
      {children}
      <Button variant="outline" size="sm" onClick={onExit}>
        Back to map
      </Button>
    </div>
  </div>
);

const PanelBody: FC<{ osmId: string; onExit: () => void }> = ({ osmId, onExit }) => {
  const { building, loading, error, objectId, country } = useBuildingState(osmId);
  const { geometry, error: geometryError } = useBuildingGeometry(objectId, country);

  if (loading) return <Notice onExit={onExit}>Loading this building…</Notice>;
  if (error) return <Notice onExit={onExit}>{error}</Notice>;
  if (!building) return null;

  // A geometry failure is reported rather than passed on as null, which the
  // view reads as still loading and would leave spinning for good.
  if (geometryError) return <Notice onExit={onExit}>{geometryError}</Notice>;

  return <Building3DView building={building} geometry={geometry} onExit={onExit} />;
};

export const BuildingPanelHost: FC = () => {
  const { buildingId, isOpen, close } = useConfiguratorParams();

  if (!isOpen || buildingId === null) return null;

  // Fills the area the application's chrome leaves, rather than the viewport.
  //
  // Building3DView is `fixed inset-0`, so left alone it covers the top bar and
  // the sidebar rail, and at its own z-20 it instead renders underneath them
  // and loses its header, which carries the back button and the Basic/Expert
  // toggle. Neither is wanted. Forcing the child to `absolute` makes its
  // inset-0 resolve against this element, so the chrome stays usable and the
  // view still gets every pixel that is left.
  return (
    <div className="bg-background fixed right-0 bottom-0 z-[60] top-[var(--topbar-height)] left-[var(--sidebar-width)] [&>div]:!absolute">
      <BuildingConfiguratorProvider http={heatClient}>
        <PanelBody osmId={buildingId} onExit={close} />
      </BuildingConfiguratorProvider>
    </div>
  );
};
