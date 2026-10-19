import { useState } from "react";
import { TriangleAlert, X } from "lucide-react";
import { useTranslation } from "@spatialhub/i18n";

/** Above this many active buildings a model run takes considerably longer. */
export const LARGE_MODEL_BUILDINGS = 50;

/**
 * Warns that a large model takes longer to compute: every building runs
 * through BuEM and Calliope solves every building's hourly demand. It informs
 * only; nothing is blocked. It shows as an icon over the map and opens into
 * the full message on click, so it does not cover the map while editing.
 */
export const LargeModelWarning = ({ buildingCount }: { buildingCount: number }) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  if (buildingCount <= LARGE_MODEL_BUILDINGS) return null;
  const title = t("simulation.largeModel.title", { count: buildingCount });

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={title}
        title={title}
        aria-expanded={false}
        className="absolute top-4 left-16 z-40 flex h-9 w-9 items-center justify-center rounded-lg border border-amber-300 bg-amber-50 text-amber-600 shadow-lg hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-400 dark:hover:bg-amber-900"
      >
        <TriangleAlert className="h-5 w-5" aria-hidden="true" />
      </button>
    );
  }

  return (
    <div
      role="alert"
      className="absolute top-4 left-16 z-40 flex max-w-md gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-amber-900 shadow-lg dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100"
    >
      <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
      <div className="text-sm">
        <p className="font-semibold">{title}</p>
        <p className="mt-1">{t("simulation.largeModel.description", { limit: LARGE_MODEL_BUILDINGS })}</p>
      </div>
      <button
        type="button"
        onClick={() => setOpen(false)}
        aria-label={t("common.close")}
        aria-expanded={true}
        className="-mr-1 -mt-1 h-6 w-6 shrink-0 rounded text-amber-700 hover:bg-amber-100 dark:text-amber-300 dark:hover:bg-amber-900"
      >
        <X className="mx-auto h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
};
