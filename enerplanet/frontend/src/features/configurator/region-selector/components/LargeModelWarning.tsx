import { TriangleAlert } from "lucide-react";
import { useTranslation } from "@spatialhub/i18n";

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
    <div
      role="alert"
      className="absolute top-4 left-16 z-40 flex max-w-md gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-amber-900 shadow-lg dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100"
    >
      <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
      <div className="text-sm">
        <p className="font-semibold">{t("simulation.largeModel.title", { count: buildingCount })}</p>
        <p className="mt-1">{t("simulation.largeModel.description", { limit: LARGE_MODEL_BUILDINGS })}</p>
      </div>
    </div>
  );
};
