import { useTranslation } from "@spatialhub/i18n";
import { MapWarning } from "./MapWarning";

/** Above this many active buildings a model run takes considerably longer. */
export const LARGE_MODEL_BUILDINGS = 50;

/**
 * Warns that a large model takes longer to compute: every building runs
 * through BuEM and Calliope solves every building's hourly demand. It informs
 * only; nothing is blocked.
 */
export const LargeModelWarning = ({ buildingCount }: { buildingCount: number }) => {
  const { t } = useTranslation();
  if (buildingCount <= LARGE_MODEL_BUILDINGS) return null;
  return (
    <MapWarning
      title={t("simulation.largeModel.title", { count: buildingCount })}
      description={t("simulation.largeModel.description", { limit: LARGE_MODEL_BUILDINGS })}
    />
  );
};
