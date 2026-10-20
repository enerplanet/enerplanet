import { TriangleAlert } from "lucide-react";
import { useTranslation } from "@spatialhub/i18n";

/**
 * Shown while the drawn or imported area holds more buildings than the model
 * may; the area stays on the map and nothing is fetched until it fits.
 */
export const AreaLimitWarning = ({ overLimit }: { overLimit: { count: number; capped: boolean; limit: number } | null }) => {
  const { t } = useTranslation();
  if (!overLimit) return null;
  // A capped count is a lower bound, shown as "10,000+".
  const plus = overLimit.capped ? "+" : "";
  const count = `${overLimit.count.toLocaleString()}${plus}`;
  const excess = `${(overLimit.count - overLimit.limit).toLocaleString()}${plus}`;
  return (
    <div
      role="alert"
      className="absolute top-4 left-16 z-40 flex max-w-md gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-amber-900 shadow-lg dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100"
    >
      <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
      <div className="text-sm">
        <p className="font-semibold">{t("gridNotifications.areaOverLimit.title", { buildings: count, limit: overLimit.limit })}</p>
        <p className="mt-1">{t("gridNotifications.areaOverLimit.description", { excess, limit: overLimit.limit })}</p>
      </div>
    </div>
  );
};
