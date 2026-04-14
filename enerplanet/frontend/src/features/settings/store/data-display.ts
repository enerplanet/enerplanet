import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface DisplayPreferences {
  temperatureUnit: 'celsius' | 'fahrenheit';
  distanceUnit: 'kilometers' | 'miles';
  windSpeedUnit: 'kmh' | 'mph' | 'ms' | 'knots';
  refreshInterval: number;
}

interface DataDisplayStore extends DisplayPreferences {
  setPreference: <K extends keyof DisplayPreferences>(key: K, value: DisplayPreferences[K]) => void;
}

export const useDataDisplayStore = create<DataDisplayStore>()(
  persist(
    (set) => ({
      temperatureUnit: 'celsius',
      distanceUnit: 'kilometers',
      windSpeedUnit: 'kmh',
      refreshInterval: 5,
      setPreference: (key, value) => set((state) => ({ ...state, [key]: value })),
    }),
    {
      name: 'data-display-preferences',
    }
  )
);
