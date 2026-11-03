import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

/**
 * How much of the configurator's UI is exposed.
 * "simple" hides sections whose every field has a sensible default; "advanced"
 * shows the full set. This is a UI preference, deliberately NOT model state:
 * it lives outside the model store (which resets per model) and is persisted
 * so the choice sticks across sessions and models.
 */
export type ConfiguratorMode = "simple" | "advanced";

interface ConfiguratorModeState {
  mode: ConfiguratorMode;
  setMode: (mode: ConfiguratorMode) => void;
  /** In simple mode just a handful of settings are shown; advanced shows the rest. */
  isAdvanced: () => boolean;
}

export const useConfiguratorModeStore = create<ConfiguratorModeState>()(
  persist(
    (set, get) => ({
      mode: "simple",
      setMode: (mode) => set({ mode }),
      isAdvanced: () => get().mode === "advanced",
    }),
    {
      name: "configurator-mode-store",
      storage: createJSONStorage(() => localStorage),
    }
  )
);