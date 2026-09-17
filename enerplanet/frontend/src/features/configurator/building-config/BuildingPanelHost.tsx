/**
 * Puts the building configurator panel on screen for whichever building the
 * URL names, and supplies the backdrop the panel itself does not draw.
 *
 * Nothing sets `?building=` yet, so this renders nothing during normal use.
 * Switching the map click over to openBuilding is what turns it on.
 */

import type { FC } from 'react';

import { BuildingConfigurator } from './panel';
import { useBuildingState } from './useBuildingState';
import { useConfiguratorParams } from './useConfiguratorParams';

/** Centred message for the states where there is no panel to show yet. */
const Notice: FC<{ children: string }> = ({ children }) => (
  <div className="bg-card text-muted-foreground rounded-lg px-6 py-5 text-sm shadow-2xl">
    {children}
  </div>
);

export const BuildingPanelHost: FC = () => {
  const { buildingId, isOpen, close } = useConfiguratorParams();
  const { building, loading, error } = useBuildingState(isOpen ? buildingId : null);

  if (!isOpen || buildingId === null) return null;

  return (
    <button
      type="button"
      aria-label="Close the building configurator"
      onClick={(event) => {
        // Only the backdrop itself closes; a click inside the panel is the
        // user working, not dismissing.
        if (event.target === event.currentTarget) close();
      }}
      className="fixed inset-0 z-50 flex cursor-default items-center justify-center bg-slate-900/45 backdrop-blur-sm"
    >
      {loading && <Notice>Loading this building…</Notice>}
      {!loading && error && <Notice>{error}</Notice>}
      {!loading && building && <BuildingConfigurator buildingData={building} onClose={close} />}
    </button>
  );
};
