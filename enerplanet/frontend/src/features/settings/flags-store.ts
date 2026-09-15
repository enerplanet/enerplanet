import { create } from "zustand";
import { persist } from "zustand/middleware";
import { FEATURE_FLAGS } from "./flags";

/**
 * User-toggleable feature flag store.
 *
 * Persists only explicit overrides in localStorage (`feature-flags`) and falls
 * back to each flag's registry default when the user has never toggled it, so a
 * flag ships "off" even though nothing is stored.
 */

interface FeatureFlagsState {
  /** Only the flags the user has explicitly toggled. */
  enabled: Record<string, boolean>;
  setFlag: (id: string, value: boolean) => void;
}

export const useFeatureFlagsStore = create<FeatureFlagsState>()(
  persist(
    (set) => ({
      enabled: {},
      setFlag: (id, value) =>
        set((state) => ({ enabled: { ...state.enabled, [id]: value } })),
    }),
    { name: "feature-flags" }
  )
);

/**
 * Reactive hook: true if the flag is enabled. Resolves the stored override,
 * falling back to the registry default.
 */
export function useFeatureFlag(id: string): boolean {
  const stored = useFeatureFlagsStore((state) => state.enabled[id]);
  const definition = FEATURE_FLAGS.find((flag) => flag.id === id);
  return stored ?? definition?.default ?? false;
}

/** Non-reactive read for non-React contexts (e.g. config/gating outside render). */
export function isFeatureFlagEnabled(id: string): boolean {
  const stored = useFeatureFlagsStore.getState().enabled[id];
  const definition = FEATURE_FLAGS.find((flag) => flag.id === id);
  return stored ?? definition?.default ?? false;
}