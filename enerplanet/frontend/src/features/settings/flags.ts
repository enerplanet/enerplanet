/**
 * Feature flag registry — the single source of truth for user-toggleable flags.
 *
 * The settings panel (`featureFlags.tsx`) renders from this list and the router
 * / other consumers read the reactive value from `flags-store.ts`. Adding a
 * flag = adding one entry here; the panel and the store pick it up automatically.
 */

export type FeatureFlagCategory = "general" | "experimental";

export interface FeatureFlagDefinition {
  /** Stable key. Consumed by `useFeatureFlag(id)` and the settings panel. */
  id: string;
  category: FeatureFlagCategory;
  /** i18n keys resolved via `useTranslation` in the settings panel. */
  labelKey: string;
  descriptionKey: string;
  /** State used when the user has never explicitly toggled the flag. */
  default: boolean;
}

export const FEATURE_FLAGS: FeatureFlagDefinition[] = [
  {
    id: "modelbuilder",
    category: "experimental",
    labelKey: "settings.featureFlags.flags.modelbuilder.label",
    descriptionKey: "settings.featureFlags.flags.modelbuilder.description",
    default: false,
  },
];

export function getFlagsByCategory(
  category: FeatureFlagCategory
): FeatureFlagDefinition[] {
  return FEATURE_FLAGS.filter((flag) => flag.category === category);
}