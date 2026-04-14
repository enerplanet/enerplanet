import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { settingsService } from '@/features/settings/services/settings';
import { 
  BaseLocation, 
  isAuthenticated, 
  addLocationToList, 
  removeLocationFromList 
} from '@/features/locations/store/location-store-factory';

// Weather location type
type WeatherLocation = BaseLocation;

interface WeatherLocationState {
  location: WeatherLocation;
  customLocations: WeatherLocation[];
  isLoading: boolean;
  syncError: string | null;
  setLocation: (loc: WeatherLocation) => void;
  addCustomLocation: (loc: WeatherLocation) => void;
  removeCustomLocation: (id: string) => void;
  clearCustomLocations: () => void;
  syncFromBackend: () => Promise<void>;
}

// Default location: Deggendorf, Germany
const DEFAULT_LOCATION: WeatherLocation = {
  id: 'default-deggendorf',
  name: 'Deggendorf, Germany',
  latitude: 48.83,
  longitude: 12.96,
  source: 'preset'
};

// Helper to sync state to backend
const syncToBackend = async (
  location: WeatherLocation,
  customLocations: WeatherLocation[],
  set: (state: Partial<WeatherLocationState>) => void
) => {
  if (!isAuthenticated()) return;

  try {
    await settingsService.setWeatherLocation({ location, customLocations });
  } catch (err) {
    if (import.meta.env.DEV) console.error('Failed to save to backend:', err);
    set({ syncError: 'Failed to save location' });
  }
};

export const useWeatherLocationStore = create<WeatherLocationState>()(
  persist(
    (set, get) => ({
      location: DEFAULT_LOCATION,
      customLocations: [],
      isLoading: false,
      syncError: null,

      setLocation: (loc) => {
        set({ location: loc });
        syncToBackend(loc, get().customLocations, set);
      },

      addCustomLocation: (loc) => {
        const { normalized, next } = addLocationToList(loc, get().customLocations, 'custom');
        set({ customLocations: next, location: normalized });
        syncToBackend(normalized, next, set);
      },

      removeCustomLocation: (id) => {
        const { remaining, nextLocation } = removeLocationFromList(
          id, get().location, get().customLocations, DEFAULT_LOCATION
        );
        set({ customLocations: remaining, location: nextLocation });
        syncToBackend(nextLocation, remaining, set);
      },

      clearCustomLocations: () => {
        const current = get().location;
        const nextLocation = current.source === 'custom' ? DEFAULT_LOCATION : current;
        set({ customLocations: [], location: nextLocation });

        if (!isAuthenticated()) return;

        settingsService.deleteWeatherLocation().catch(err => {
          if (import.meta.env.DEV) console.error('Failed to delete weather location:', err);
          set({ syncError: 'Failed to delete location' });
        });
      },

      syncFromBackend: async () => {
        if (!isAuthenticated()) return;

        set({ isLoading: true, syncError: null });
        try {
          const data = await settingsService.getWeatherLocation();
          if (data?.location && data?.customLocations) {
            set({
              location: data.location,
              customLocations: data.customLocations,
              isLoading: false,
              syncError: null
            });
          } else {
            set({ isLoading: false });
          }
        } catch (error) {
          if (import.meta.env.DEV) console.error('Failed to sync from backend:', error);
          set({ isLoading: false, syncError: 'Failed to load saved locations' });
        }
      }
    }),
    {
      name: 'weather-location-store',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        location: state.location,
        customLocations: state.customLocations,
      }),
    }
  )
);
