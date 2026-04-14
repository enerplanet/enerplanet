import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { settingsService } from '@/features/settings/services/settings';

interface FavoriteModelsState {
  favoriteIds: number[];
  toggleFavorite: (id: number) => void;
  isFavorite: (id: number) => boolean;
  syncFromBackend: () => Promise<void>;
}

const isAuthenticated = () => {
  try {
    const authStore = localStorage.getItem('auth-storage');
    if (!authStore) return false;
    const parsed = JSON.parse(authStore);
    return !!parsed?.state?.user;
  } catch {
    return false;
  }
};

const syncToBackend = async (favoriteIds: number[]) => {
  if (!isAuthenticated()) return;
  try {
    await settingsService.setSetting('favorite_models', JSON.stringify(favoriteIds));
  } catch (err) {
    if (import.meta.env.DEV) console.error('Failed to save favorite models:', err);
  }
};

export const useFavoriteModelsStore = create<FavoriteModelsState>()(
  persist(
    (set, get) => ({
      favoriteIds: [],

      toggleFavorite: (id: number) => {
        const current = get().favoriteIds;
        const next = current.includes(id)
          ? current.filter(fid => fid !== id)
          : [...current, id];
        set({ favoriteIds: next });
        syncToBackend(next);
      },

      isFavorite: (id: number) => {
        return get().favoriteIds.includes(id);
      },

      syncFromBackend: async () => {
        if (!isAuthenticated()) return;
        try {
          const raw = await settingsService.getSetting('favorite_models');
          if (raw) {
            const parsed = JSON.parse(raw) as number[];
            if (Array.isArray(parsed)) {
              set({ favoriteIds: parsed });
            }
          }
        } catch (err) {
          if (import.meta.env.DEV) console.error('Failed to sync favorite models:', err);
        }
      },
    }),
    {
      name: 'favorite-models-store',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ favoriteIds: state.favoriteIds }),
    }
  )
);
