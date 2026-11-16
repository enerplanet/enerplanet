import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { getFlagDefinition, type FeatureFlagId } from "./flags";

/**
 * User-toggleable feature flag store.
 *
 * Only explicit user choices are persisted (`enabled`), so a flag ships "off"
 * even though nothing is stored yet: reads fall back to the registry default.
 * Like every other client preference this is NOT model state — it survives
 * model switches and reloads (localStorage key `feature-flags`).
 */

interface FeatureFlagsState {
  /** Only the flags the user (or a deep link) explicitly changed. */
  enabled: Record<string, boolean>;
  setFlag: (id: FeatureFlagId, value: boolean) => void;
  /** Drops every override, restoring registry defaults. */
  reset: () => void;
}

export const useFeatureFlagsStore = create<FeatureFlagsState>()(
  persist(
    (set) => ({
      enabled: {},
      setFlag: (id, value) =>
        set((state) => ({ enabled: { ...state.enabled, [id]: value } })),
      reset: () => set({ enabled: {} }),
    }),
    {
      name: "feature-flags",
      storage: createJSONStorage(() => localStorage),
    },
  ),
);

/** Reactive hook — re-renders subscribers when the user flips the flag. */
export function useFeatureFlag(id: FeatureFlagId): boolean {
  const stored = useFeatureFlagsStore((state) => state.enabled[id]);
  return stored ?? getFlagDefinition(id)?.default ?? false;
}

/** Non-reactive read for non-React contexts (route setup, guards, services). */
export function isFeatureFlagEnabled(id: FeatureFlagId): boolean {
  const stored = useFeatureFlagsStore.getState().enabled[id];
  return stored ?? getFlagDefinition(id)?.default ?? false;
}
