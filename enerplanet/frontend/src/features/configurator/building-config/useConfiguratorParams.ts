// Deep-link state for the configurator lives in the URL query string, not in a
// route path: `?building=<osmId>`, plus `&pv=1` for PV mode. This keeps the
// configurator mounted alongside the existing model page and survives a
// refresh or a shared link. Navigation within the configurator is the
// package's own, not the URL's.

import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";

const BUILDING_PARAM = "building";
const PV_PARAM = "pv";

export interface ConfiguratorParams {
  /** osm_id of the open building, or null when the configurator is closed. */
  buildingId: string | null;
  isOpen: boolean;
  /** The building is open for placing PV. */
  pvMode: boolean;
  openBuilding: (osmId: string, options?: { pv?: boolean }) => void;
  close: () => void;
}

export function useConfiguratorParams(): ConfiguratorParams {
  const [params, setParams] = useSearchParams();

  const buildingId = params.get(BUILDING_PARAM) || null;
  const pvMode = params.get(PV_PARAM) === "1";

  const openBuilding = useCallback(
    (osmId: string, options?: { pv?: boolean }) => {
      setParams((prev) => {
        const p = new URLSearchParams(prev);
        p.set(BUILDING_PARAM, osmId);
        if (options?.pv) p.set(PV_PARAM, "1");
        else p.delete(PV_PARAM);
        return p;
      });
    },
    [setParams],
  );

  const close = useCallback(() => {
    setParams((prev) => {
      const p = new URLSearchParams(prev);
      p.delete(BUILDING_PARAM);
      p.delete(PV_PARAM);
      return p;
    });
  }, [setParams]);

  return useMemo(
    () => ({
      buildingId,
      isOpen: buildingId !== null,
      pvMode,
      openBuilding,
      close,
    }),
    [buildingId, pvMode, openBuilding, close],
  );
}
