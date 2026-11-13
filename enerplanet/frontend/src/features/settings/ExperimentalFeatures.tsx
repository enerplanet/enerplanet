import React from "react";
import { Switch, cn } from "@spatialhub/ui";
import { FlaskConical, Flag, TriangleAlert } from "lucide-react";
import { useTranslation } from "@spatialhub/i18n";
import {
  FEATURE_FLAGS,
  sectionTitleKey,
  type FeatureFlagCategory,
  type FeatureFlagDefinition,
} from "./flags";
import { useFeatureFlag, useFeatureFlagsStore } from "./flags-store";

/**
 * Experimental Features panel (Settings → Experimental).
 *
 * Lists every flag from the registry (`flags.ts`) and writes toggles through
 * `flags-store.ts`, so flipping a switch immediately re-renders whatever
 * subscribes to `useFeatureFlag` — the route guard in `App.tsx` included.
 * No restart, no `.env` edit.
 *
 * Rows are grouped by category, in registry order, with a divider between the
 * groups — `general` (e.g. the tab's own visibility) reads as a separate block
 * from the actual `experimental` features.
 */

/** Registry grouped by category, in first-appearance order. Static by design. */
const SECTIONS: { category: FeatureFlagCategory; flags: FeatureFlagDefinition[] }[] = (() => {
  const sections: { category: FeatureFlagCategory; flags: FeatureFlagDefinition[] }[] = [];
  for (const flag of FEATURE_FLAGS) {
    let section = sections.find((candidate) => candidate.category === flag.category);
    if (!section) {
      section = { category: flag.category, flags: [] };
      sections.push(section);
    }
    section.flags.push(flag);
  }
  return sections;
})();

const FlagRow: React.FC<{ flag: FeatureFlagDefinition }> = ({ flag }) => {
  const { t } = useTranslation();
  const checked = useFeatureFlag(flag.id);
  const setFlag = useFeatureFlagsStore((state) => state.setFlag);
  const label = t(flag.labelKey);
  const Icon = flag.category === "experimental" ? FlaskConical : Flag;

  return (
    <div
      className={cn(
        "md-row-in flex items-center justify-between gap-3 rounded-md border px-2.5 py-2 transition-all duration-200",
        checked ? "border-primary/50 bg-muted/50" : "border-border bg-card",
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        <div
          className={cn(
            "rounded p-1.5",
            checked
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground",
          )}
        >
          <Icon className="h-3 w-3" />
        </div>
        <div className="min-w-0">
          <h4 className="text-xs font-medium text-foreground">{label}</h4>
          <p className="text-[10px] text-muted-foreground">
            {t(flag.descriptionKey)}
          </p>
        </div>
      </div>
      <Switch
        id={`feature-flag-${flag.id}`}
        checked={checked}
        onCheckedChange={(value) => setFlag(flag.id, value)}
        className="shrink-0"
        aria-label={label}
      />
    </div>
  );
};

const ExperimentalFeatures: React.FC = () => {
  const { t } = useTranslation();

  if (FEATURE_FLAGS.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        {t("settings.featureFlags.empty")}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-start gap-2.5 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
        <div className="text-xs">
          <p className="font-medium text-amber-700 dark:text-amber-300">
            {t("settings.featureFlags.warning.title")}
          </p>
          <p className="mt-0.5 text-muted-foreground">
            {t("settings.featureFlags.warning.description")}
          </p>
        </div>
      </div>

      <div className="space-y-2">
        {SECTIONS.map((section, index) => (
          <React.Fragment key={section.category}>
            {index > 0 && (
              <>
                <div
                  role="separator"
                  className="my-2 h-0.5 w-full shrink-0 rounded-full bg-muted-foreground"
                />
                <h3 className="px-0.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {t(sectionTitleKey(section.category))}
                </h3>
              </>
            )}
            <div className="space-y-2">
              {section.flags.map((flag) => (
                <FlagRow key={flag.id} flag={flag} />
              ))}
            </div>
          </React.Fragment>
        ))}
      </div>
    </div>
  );
};

export default ExperimentalFeatures;
