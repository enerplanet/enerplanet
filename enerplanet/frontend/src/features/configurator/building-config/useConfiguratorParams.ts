// Deep-link state for the configurator lives in the URL query string, not in a
// route path: `?building=<osmId>`. This keeps the configurator mounted
// alongside the existing model page and survives a refresh or a shared link.
// Navigation within the configurator is the package's own, not the URL's.

import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";

const BUILDING_PARAM = "building";

export interface ConfiguratorParams {
  /** osm_id of the open building, or null when the configurator is closed. */
  buildingId: string | null;
  isOpen: boolean;
  openBuilding: (osmId: string) => void;
  close: () => void;
}

export function useConfiguratorParams(): ConfiguratorParams {
  const [params, setParams] = useSearchParams();

  const buildingId = params.get(BUILDING_PARAM) || null;

  const openBuilding = useCallback(
    (osmId: string) => {
      setParams((prev) => {
        const p = new URLSearchParams(prev);
        p.set(BUILDING_PARAM, osmId);
        return p;
      });
    },
    [setParams],
  );

  const close = useCallback(() => {
    setParams((prev) => {
      const p = new URLSearchParams(prev);
      p.delete(BUILDING_PARAM);
      return p;
    });
  }, [setParams]);

  return useMemo(
    () => ({
      buildingId,
      isOpen: buildingId !== null,
      openBuilding,
      close,
    }),
    [buildingId, openBuilding, close],
  );
}
