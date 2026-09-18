/**
 * Puts the building configurator on screen for whichever building the URL
 * names, and supplies the backdrop the package does not draw itself.
 *
 * The provider is mounted here rather than at the application root so the
 * package's clients are built only once a building is actually open.
 */

import { useEffect, type FC } from 'react';

import {
  BuildingConfigurator,
  BuildingConfiguratorProvider,
} from '@thd-spatial-ai/building-configurator';

import { heatClient } from './heatClient';
import { useBuildingState } from './useBuildingState';
import { useConfiguratorParams } from './useConfiguratorParams';

/** Centred message for the states where there is no configurator to show yet. */
const Notice: FC<{ children: string }> = ({ children }) => (
  <div className="bg-card text-muted-foreground rounded-lg px-6 py-5 text-sm shadow-2xl">
    {children}
  </div>
);

const PanelBody: FC<{ osmId: string; onClose: () => void }> = ({ osmId, onClose }) => {
  const { building, loading, error } = useBuildingState(osmId);

  if (loading) return <Notice>Loading this building…</Notice>;
  if (error) return <Notice>{error}</Notice>;
  if (!building) return null;
  return <BuildingConfigurator buildingData={building} onClose={onClose} />;
};

export const BuildingPanelHost: FC = () => {
  const { buildingId, isOpen, close } = useConfiguratorParams();

  // Escape closes the panel. The backdrop cannot be a button, because the
  // configurator inside it is full of them and a button may not nest, so this
  // is what gives the dismissal a keyboard route.
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    globalThis.addEventListener('keydown', onKeyDown);
    return () => globalThis.removeEventListener('keydown', onKeyDown);
  }, [isOpen, close]);

  if (!isOpen || buildingId === null) return null;

  return (
    <div
      role="presentation"
      onClick={(event) => {
        // Only the backdrop itself closes; a click inside the panel is the
        // user working, not dismissing.
        if (event.target === event.currentTarget) close();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 backdrop-blur-sm"
    >
      <BuildingConfiguratorProvider http={heatClient}>
        <PanelBody osmId={buildingId} onClose={close} />
      </BuildingConfiguratorProvider>
    </div>
  );
};
