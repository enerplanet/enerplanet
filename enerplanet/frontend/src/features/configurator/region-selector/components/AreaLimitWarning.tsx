import { useTranslation } from "@spatialhub/i18n";
import { MapWarning } from "./MapWarning";

/**
 * Shown while the drawn or imported area holds more buildings than the model
 * may; the area stays on the map and nothing is fetched until it fits. The
 * collapsed label keeps the count in view while the user shrinks the area.
 */
export const AreaLimitWarning = ({ overLimit }: { overLimit: { count: number; capped: boolean; limit: number } | null }) => {
  const { t } = useTranslation();
  if (!overLimit) return null;
  // A capped count is a lower bound, shown as "10,000+".
  const plus = overLimit.capped ? "+" : "";
  const count = `${overLimit.count.toLocaleString()}${plus}`;
  const excess = `${(overLimit.count - overLimit.limit).toLocaleString()}${plus}`;
  return (
    <MapWarning
      title={t("gridNotifications.areaOverLimit.title", { buildings: count, limit: overLimit.limit })}
      description={t("gridNotifications.areaOverLimit.description", { excess, limit: overLimit.limit })}
      collapsedLabel={`${count} / ${overLimit.limit.toLocaleString()}`}
    />
  );
};
