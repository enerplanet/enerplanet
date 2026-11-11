/**
 * Feature flag registry — the single source of truth for user-toggleable flags.
 *
 * ── Adding a toggle ────────────────────────────────────────────────────────
 * 1. Add ONE entry to `REGISTRY` below (`id`, `category`, `default`).
 * 2. Add two i18n keys per locale file:
 *      settings.featureFlags.flags.<id>.label
 *      settings.featureFlags.flags.<id>.description
 *    (the keys are derived from the id — nothing to wire up here)
 *
 * That is all. The settings panel lists it automatically, `useFeatureFlag` /
 * `<FeatureFlagGate>` accept its id (typed, so a typo is a compile error), and
 * `flags.test.ts` fails if a locale is missing its label/description.
 *
 * ── Using a toggle inside the app ──────────────────────────────────────────
 *   const on = useFeatureFlag("modelbuilder");              // reactive (hook)
 *   <FeatureFlagGate flag="modelbuilder">…</FeatureFlagGate>
 *   isFeatureFlagEnabled("modelbuilder")                    // non-React read
 *
 * See `featureflag.md` next to this file for the full recipe.
 */

export type FeatureFlagCategory = "general" | "experimental";

/**
 * The registry. Each entry is one toggle; everything else is derived.
 *
 * - `id`       stable key — also the i18n key segment and the store key
 * - `category` `experimental` flags render under the amber warning banner
 * - `default`  value used while the user has never toggled it
 */
const REGISTRY = [
  { id: "experimentalSettings", category: "general", default: false },
  { id: "modelbuilder", category: "experimental", default: false },
] as const satisfies ReadonlyArray<{
  id: string;
  category: FeatureFlagCategory;
  default: boolean;
}>;

/** Union of every registered flag id — passing an unknown id is a type error. */
export type FeatureFlagId = (typeof REGISTRY)[number]["id"];

export interface FeatureFlagDefinition {
  id: FeatureFlagId;
  category: FeatureFlagCategory;
  default: boolean;
  /** Derived: `settings.featureFlags.flags.<id>.label`. */
  labelKey: string;
  /** Derived: `settings.featureFlags.flags.<id>.description`. */
  descriptionKey: string;
}

/** i18n keys for a flag id — derived, so they can never drift from the id. */
export function flagI18nKeys(id: string): {
  labelKey: string;
  descriptionKey: string;
} {
  return {
    labelKey: `settings.featureFlags.flags.${id}.label`,
    descriptionKey: `settings.featureFlags.flags.${id}.description`,
  };
}

/** i18n key for a category's section heading in the panel. */
export function sectionTitleKey(category: FeatureFlagCategory): string {
  return `settings.featureFlags.sections.${category}.title`;
}

/** The registry with its i18n keys resolved — what the panel iterates. */
export const FEATURE_FLAGS: FeatureFlagDefinition[] = REGISTRY.map((flag) => ({
  ...flag,
  ...flagI18nKeys(flag.id),
}));

export function getFlagsByCategory(
  category: FeatureFlagCategory,
): FeatureFlagDefinition[] {
  return FEATURE_FLAGS.filter((flag) => flag.category === category);
}

export function getFlagDefinition(id: string): FeatureFlagDefinition | undefined {
  return FEATURE_FLAGS.find((flag) => flag.id === id);
}
