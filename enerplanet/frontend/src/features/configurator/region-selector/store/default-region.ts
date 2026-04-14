import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { settingsService } from '@/features/settings/services/settings';
import type { AvailableRegion } from '../components/RegionSelector';

interface DefaultRegionState {
  defaultRegion: AvailableRegion | null;
  setDefaultRegion: (region: AvailableRegion | null) => void;
  syncFromBackend: () => Promise<void>;
}

const isAuthenticated = () => !!document.cookie.includes('session');

const syncToBackend = async (region: AvailableRegion | null) => {
  if (!isAuthenticated()) return;
  try {
    await settingsService.setDefaultRegion(region);
  } catch (err) {
    if (import.meta.env.DEV) console.error('Failed to sync default region to backend:', err);
  }
};

export const useDefaultRegionStore = create<DefaultRegionState>()(
  persist(
    (set) => ({
      defaultRegion: null,

      setDefaultRegion: (region) => {
        set({ defaultRegion: region });
        syncToBackend(region);
      },

      syncFromBackend: async () => {
        if (!isAuthenticated()) return;
        try {
          const data = await settingsService.getDefaultRegion();
          if (data) {
            set({ defaultRegion: data as AvailableRegion });
          }
        } catch (err) {
          if (import.meta.env.DEV) console.error('Failed to sync default region from backend:', err);
        }
      },
    }),
    {
      name: 'default-region-store',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        defaultRegion: state.defaultRegion,
      }),
    }
  )
);
