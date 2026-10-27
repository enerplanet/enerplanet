import { create } from 'zustand';
import { customLocationService, type CustomLocation, type CustomLocationCreateRequest, type CustomLocationUpdateRequest } from '@/features/locations/services/customLocationService';

interface CustomLocationState {
  locations: CustomLocation[];
  isLoading: boolean;
  error: string | null;

  // Actions
  fetchUserLocations: () => Promise<void>;
  refetchLocations: () => Promise<void>;
  createLocation: (location: CustomLocationCreateRequest) => Promise<CustomLocation>;
  updateLocation: (id: number, updates: CustomLocationUpdateRequest) => Promise<CustomLocation>;
  deleteLocation: (id: number) => Promise<void>;
  copyLocation: (id: number) => Promise<CustomLocation>;
  clearError: () => void;
}

export const useCustomLocationStore = create<CustomLocationState>((set, get) => ({
  locations: [],
  isLoading: false,
  error: null,

  fetchUserLocations: async () => {
    set({ isLoading: true, error: null });
    try {
      const response = await customLocationService.getUserLocations({ per_page: 100 });
      set({ locations: response.data, isLoading: false });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch locations';
      set({ error: message, isLoading: false });
    }
  },

  // Refetch without showing loading spinner (for background refresh)
  refetchLocations: async () => {
    try {
      const response = await customLocationService.getUserLocations({ per_page: 100 });
      set({ locations: response.data, error: null });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to refresh locations';
      set({ error: message });
    }
  },

  createLocation: async (location: CustomLocationCreateRequest) => {
    set({ isLoading: true, error: null });
    try {
      const newLocation = await customLocationService.createLocation(location);
      set((state) => ({
        locations: [newLocation, ...state.locations],
        isLoading: false,
      }));
      return newLocation;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create location';
      set({ error: message, isLoading: false });
      throw error;
    }
  },

  updateLocation: async (id: number, updates: CustomLocationUpdateRequest) => {
    // Validate ID
    if (id === undefined || id === null) {
      throw new Error('Invalid location ID');
    }

    // Optimistic update - update immediately without loading
    const previousLocations = get().locations;

    set((state) => ({
      locations: state.locations.map((loc) =>
        loc.id === id ? { ...loc, ...updates } : loc
      ),
    }));

    try {
      const updatedLocation = await customLocationService.updateLocation(id, updates);
      set((state) => {
        // Find the index of the old location and replace it with the new one
        const locationIndex = state.locations.findIndex((loc) => loc.id === id);
        const newLocations = [...state.locations];
        if (locationIndex !== -1) {
          newLocations[locationIndex] = updatedLocation;
        }

        return { locations: newLocations };
      });
      return updatedLocation;
    } catch (error) {
      // Revert on error
      set({ locations: previousLocations });
      const message = error instanceof Error ? error.message : 'Failed to update location';
      set({ error: message });
      throw error;
    }
  },

  deleteLocation: async (id: number) => {
    // Optimistic delete
    const previousLocations = get().locations;
    set((state) => ({
      locations: state.locations.filter((loc) => loc.id !== id),
    }));

    try {
      await customLocationService.deleteLocation(id);
    } catch (error) {
      // Revert on error
      set({ locations: previousLocations });
      const message = error instanceof Error ? error.message : 'Failed to delete location';
      set({ error: message });
      throw error;
    }
  },

  copyLocation: async (id: number) => {
    try {
      const copiedLocation = await customLocationService.copyLocation(id);
      set((state) => ({
        locations: [copiedLocation, ...state.locations],
      }));
      return copiedLocation;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to copy location';
      set({ error: message });
      throw error;
    }
  },

  clearError: () => set({ error: null }),
}));
