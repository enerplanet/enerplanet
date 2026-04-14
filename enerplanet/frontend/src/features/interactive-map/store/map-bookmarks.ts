import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { settingsService } from '@/features/settings/services/settings';

export interface MapBookmark {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  zoom: number;
}

interface MapBookmarksState {
  bookmarks: MapBookmark[];
  addBookmark: (bookmark: Omit<MapBookmark, 'id'>) => void;
  removeBookmark: (id: string) => void;
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

const syncToBackend = async (bookmarks: MapBookmark[]) => {
  if (!isAuthenticated()) return;
  try {
    await settingsService.setSetting('map_bookmarks', JSON.stringify(bookmarks));
  } catch (err) {
    if (import.meta.env.DEV) console.error('Failed to save map bookmarks:', err);
  }
};

export const useMapBookmarksStore = create<MapBookmarksState>()(
  persist(
    (set, get) => ({
      bookmarks: [],

      addBookmark: (bookmark) => {
        const newBookmark: MapBookmark = {
          ...bookmark,
          id: `bm-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        };
        const next = [...get().bookmarks, newBookmark];
        set({ bookmarks: next });
        syncToBackend(next);
      },

      removeBookmark: (id) => {
        const next = get().bookmarks.filter(b => b.id !== id);
        set({ bookmarks: next });
        syncToBackend(next);
      },

      syncFromBackend: async () => {
        if (!isAuthenticated()) return;
        try {
          const raw = await settingsService.getSetting('map_bookmarks');
          if (raw) {
            const parsed = JSON.parse(raw) as MapBookmark[];
            if (Array.isArray(parsed)) {
              set({ bookmarks: parsed });
            }
          }
        } catch (err) {
          if (import.meta.env.DEV) console.error('Failed to sync map bookmarks:', err);
        }
      },
    }),
    {
      name: 'map-bookmarks-store',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ bookmarks: state.bookmarks }),
    }
  )
);
