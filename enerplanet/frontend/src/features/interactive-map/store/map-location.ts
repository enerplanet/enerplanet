import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { settingsService } from '@/features/settings/services/settings';
import { 
  BaseLocation, 
  isAuthenticated, 
  addLocationToList, 
  removeLocationFromList 
} from '@/features/locations/store/location-store-factory';

// Map location extends base with zoom
interface MapLocation extends BaseLocation {
  zoom?: number;
}

interface MapLocationState {
  location: MapLocation;
  savedLocations: MapLocation[];
  isLoading: boolean;
  syncError: string | null;
  setLocation: (loc: MapLocation) => void;
  addSavedLocation: (loc: MapLocation) => void;
  removeSavedLocation: (id: string) => void;
  clearSavedLocations: () => void;
  syncFromBackend: () => Promise<void>;
}

// Default map location (Deggendorf, Germany)
const DEFAULT_LOCATION: MapLocation = {
  id: 'default-deggendorf',
  name: 'Deggendorf, Germany',
  latitude: 48.83,
  longitude: 12.96,
  zoom: 12,
  source: 'preset'
};

// Helper to sync state to backend
const syncToBackend = async (
  location: MapLocation,
  savedLocations: MapLocation[],
  set: (state: Partial<MapLocationState>) => void
) => {
  if (!isAuthenticated()) return;

  try {
    await settingsService.setMapLocation({ location, savedLocations });
  } catch (err) {
    if (import.meta.env.DEV) console.error('Failed to save to backend:', err);
    set({ syncError: 'Failed to save location' });
  }
};

export const useMapLocationStore = create<MapLocationState>()(
  persist(
    (set, get) => ({
      location: DEFAULT_LOCATION,
      savedLocations: [],
      isLoading: false,
      syncError: null,

      setLocation: (loc) => {
        set({ location: loc });
        syncToBackend(loc, get().savedLocations, set);
      },

      addSavedLocation: (loc) => {
        const { normalized, next } = addLocationToList(loc, get().savedLocations, 'map');
        set({ savedLocations: next, location: normalized });
        syncToBackend(normalized, next, set);
      },

      removeSavedLocation: (id) => {
        const { remaining, nextLocation } = removeLocationFromList(
          id, get().location, get().savedLocations, DEFAULT_LOCATION
        );
        set({ savedLocations: remaining, location: nextLocation });
        syncToBackend(nextLocation, remaining, set);
      },

      clearSavedLocations: () => {
        set({ savedLocations: [], location: DEFAULT_LOCATION });
        if (!isAuthenticated()) return;

        settingsService.deleteMapLocation().catch(err => {
          if (import.meta.env.DEV) console.error('Failed to clear map locations:', err);
          set({ syncError: 'Failed to clear locations' });
        });
      },

      syncFromBackend: async () => {
        if (!isAuthenticated()) return;

        set({ isLoading: true, syncError: null });
        try {
          const data = await settingsService.getMapLocation();
          if (data?.location && data?.savedLocations) {
            set({
              location: data.location,
              savedLocations: data.savedLocations,
              isLoading: false,
              syncError: null
            });
          } else {
            set({ isLoading: false });
          }
        } catch (error) {
          if (import.meta.env.DEV) console.error('Failed to sync map location:', error);
          set({ isLoading: false, syncError: 'Failed to load saved map location' });
        }
      }
    }),
    {
      name: 'map-location-store',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        location: state.location,
        savedLocations: state.savedLocations,
      }),
    }
  )
);
