import { useState, type ReactNode } from "react";
import { TriangleAlert, X } from "lucide-react";
import { useTranslation } from "@spatialhub/i18n";

const BOX = "absolute top-4 left-16 z-40 rounded-lg border border-amber-300 bg-amber-50 shadow-lg dark:border-amber-700 dark:bg-amber-950";

/**
 * A warning over the map that stays small while the user edits: collapsed it
 * shows the icon and an optional short label, and opens into the full message
 * on click.
 */
export const MapWarning = ({ title, description, collapsedLabel }: { title: string; description: ReactNode; collapsedLabel?: string }) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={title}
        title={title}
        aria-expanded={false}
        className={`${BOX} flex h-9 items-center gap-2 px-2 text-amber-600 hover:bg-amber-100 dark:text-amber-400 dark:hover:bg-amber-900 ${collapsedLabel ? "" : "w-9 justify-center"}`}
      >
        <TriangleAlert className="h-5 w-5 shrink-0" aria-hidden="true" />
        {collapsedLabel && <span className="text-sm font-medium tabular-nums text-amber-900 dark:text-amber-100">{collapsedLabel}</span>}
      </button>
    );
  }

  return (
    <div role="alert" className={`${BOX} flex max-w-md gap-3 px-4 py-3 text-amber-900 dark:text-amber-100`}>
      <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
      <div className="text-sm">
        <p className="font-semibold">{title}</p>
        <p className="mt-1">{description}</p>
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
