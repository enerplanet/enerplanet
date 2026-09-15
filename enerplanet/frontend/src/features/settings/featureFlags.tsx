import React from "react";
import { Switch, Label, Separator } from "@spatialhub/ui";
import { TriangleAlert, FlaskConical, Flag } from "lucide-react";
import { useTranslation } from "@spatialhub/i18n";
import { getFlagsByCategory, type FeatureFlagDefinition } from "./flags";
import { useFeatureFlag, useFeatureFlagsStore } from "./flags-store";

/**
 * Feature flags panel for the Settings page.
 *
 * Reads the available flags from `flags.ts` (the registry) and writes toggles
 * through `flags-store.ts`, so flipping a switch updates the reactive store
 * that gating consumers (e.g. the router) subscribe to.
 *
 * Two sections:
 * - **Experimental** — unstable, in-development features, guarded by a warning.
 * - **Feature flags (general)** — stable toggles; currently empty.
 */

const FlagRow: React.FC<{ flag: FeatureFlagDefinition }> = ({ flag }) => {
  const { t } = useTranslation();
  const checked = useFeatureFlag(flag.id);
  const setFlag = useFeatureFlagsStore((state) => state.setFlag);

  return (
    <div className="flex items-start justify-between gap-4 py-2.5">
      <div className="min-w-0 space-y-0.5">
        <Label htmlFor={`feature-flag-${flag.id}`} className="text-sm font-medium text-foreground">
          {t(flag.labelKey)}
        </Label>
        <p className="text-xs text-muted-foreground">{t(flag.descriptionKey)}</p>
      </div>
      <Switch
        id={`feature-flag-${flag.id}`}
        checked={checked}
        onCheckedChange={(value) => setFlag(flag.id, value)}
        className="shrink-0"
        aria-label={t(flag.labelKey)}
      />
    </div>
  );
};

const FeatureFlags: React.FC = () => {
  const { t } = useTranslation();
  const experimental = getFlagsByCategory("experimental");
  const general = getFlagsByCategory("general");

  return (
    <div className="space-y-5">
      {/* ── Experimental section ─────────────────────────────────────── */}
      <section className="space-y-1">
        <div className="flex items-center gap-2 mb-1">
          <FlaskConical className="w-3.5 h-3.5 text-foreground" />
          <h3 className="text-xs font-semibold text-foreground">
            {t("settings.featureFlags.sections.experimental.title")}
          </h3>
          <span className="px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400 text-[9px] font-semibold uppercase tracking-wider">
            Experimental
          </span>
        </div>

        {/* Warning banner */}
        <div className="flex items-start gap-2.5 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
          <TriangleAlert className="w-4 h-4 mt-0.5 text-amber-600 dark:text-amber-400 shrink-0" />
          <div className="text-xs">
            <p className="font-medium text-amber-700 dark:text-amber-300">
              {t("settings.featureFlags.warning.title")}
            </p>
            <p className="text-muted-foreground">
              {t("settings.featureFlags.warning.description")}
            </p>
          </div>
        </div>

        <div className="divide-y divide-border">
          {experimental.map((flag) => (
            <FlagRow key={flag.id} flag={flag} />
          ))}
        </div>
      </section>

      <Separator />

      {/* ── General feature flags section ────────────────────────────── */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Flag className="w-3.5 h-3.5 text-foreground" />
          <h3 className="text-xs font-semibold text-foreground">
            {t("settings.featureFlags.sections.general.title")}
          </h3>
        </div>

        {general.length > 0 ? (
          <div className="divide-y divide-border">
            {general.map((flag) => (
              <FlagRow key={flag.id} flag={flag} />
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            {t("settings.featureFlags.sections.general.empty")}
          </p>
        )}
      </section>
    </div>
  );
};

export default FeatureFlags;