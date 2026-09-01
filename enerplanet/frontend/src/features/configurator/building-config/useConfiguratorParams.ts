// Deep-link state for the configurator lives in the URL query string, not in a
// route path: `?building=<osmId>&stage=<stageId>`. This keeps the configurator
// mounted alongside the existing model page and survives a refresh or a shared
// link. An invalid or missing stage falls back to the first stage.

import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { FIRST_STAGE, isStageId, type StageId } from "./stages";

const BUILDING_PARAM = "building";
const STAGE_PARAM = "stage";

export interface ConfiguratorParams {
  /** osm_id of the open building, or null when the configurator is closed. */
  buildingId: string | null;
  stage: StageId;
  isOpen: boolean;
  openBuilding: (osmId: string, stage?: StageId) => void;
  setStage: (stage: StageId) => void;
  close: () => void;
}

export function useConfiguratorParams(): ConfiguratorParams {
  const [params, setParams] = useSearchParams();

  const buildingId = params.get(BUILDING_PARAM) || null;
  const rawStage = params.get(STAGE_PARAM);
  const stage: StageId = isStageId(rawStage) ? rawStage : FIRST_STAGE;

  const openBuilding = useCallback(
    (osmId: string, next: StageId = FIRST_STAGE) => {
      setParams((prev) => {
        const p = new URLSearchParams(prev);
        p.set(BUILDING_PARAM, osmId);
        p.set(STAGE_PARAM, next);
        return p;
      });
    },
    [setParams],
  );

  const setStage = useCallback(
    (next: StageId) => {
      setParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          p.set(STAGE_PARAM, next);
          return p;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  const close = useCallback(() => {
    setParams((prev) => {
      const p = new URLSearchParams(prev);
      p.delete(BUILDING_PARAM);
      p.delete(STAGE_PARAM);
      return p;
    });
  }, [setParams]);

  return useMemo(
    () => ({
      buildingId,
      stage,
      isOpen: buildingId !== null,
      openBuilding,
      setStage,
      close,
    }),
    [buildingId, stage, openBuilding, setStage, close],
  );
}
