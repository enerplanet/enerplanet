import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { settingsService } from '@/features/settings/services/settings';

type AccessLevel = "very_low" | "intermediate" | "manager" | "expert";

const DEFAULT_LIMITS: Record<AccessLevel, number> = {
  very_low: 50,
  intermediate: 100,
  manager: 200,
  expert: 0,
};

interface PolygonLimitsStore {
  // Limits for each access level (synced from backend)
  limits: Record<AccessLevel, number>;
  isLoading: boolean;
  lastFetched: number | null;
  
  // Actions
  setLimits: (limits: Record<AccessLevel, number>) => void;
  setLimitForLevel: (level: AccessLevel, limit: number) => Promise<boolean>;
  resetToDefaults: () => Promise<boolean>;
  fetchLimits: () => Promise<void>;
  
  // Getters
  getEffectiveLimit: (accessLevel: AccessLevel) => number;
  getDefaultLimit: (accessLevel: AccessLevel) => number;
}

export const usePolygonLimitsStore = create<PolygonLimitsStore>()(
  persist(
    (set, get) => ({
      limits: { ...DEFAULT_LIMITS },
      isLoading: false,
      lastFetched: null,
      
      setLimits: (limits: Record<AccessLevel, number>) => 
        set({ limits, lastFetched: Date.now() }),
      
      setLimitForLevel: async (level: AccessLevel, limit: number) => {
        const previousLimits = { ...get().limits };
        // Optimistic update
        set(state => ({
          limits: { ...state.limits, [level]: limit }
        }));
        
        const success = await settingsService.updatePolygonLimit(level, limit);
        if (!success) {
          // Revert on failure
          set({ limits: previousLimits });
        }
        return success;
      },
      
      resetToDefaults: async () => {
        const success = await settingsService.updatePolygonLimits(DEFAULT_LIMITS as Record<string, number>);
        if (success) {
          set({ limits: { ...DEFAULT_LIMITS }, lastFetched: Date.now() });
        }
        return success;
      },
      
      fetchLimits: async () => {
        set({ isLoading: true });
        try {
          const limits = await settingsService.getPolygonLimits();
          set({ 
            limits: limits as Record<AccessLevel, number>, 
            lastFetched: Date.now(),
            isLoading: false 
          });
        } catch (error) {
          console.error('Failed to fetch polygon limits:', error);
          set({ isLoading: false });
        }
      },
      
      getEffectiveLimit: (accessLevel: AccessLevel) => {
        return get().limits[accessLevel] ?? DEFAULT_LIMITS[accessLevel] ?? 50;
      },
      
      getDefaultLimit: (accessLevel: AccessLevel) => {
        return DEFAULT_LIMITS[accessLevel] ?? 50;
      },
    }),
    {
      name: 'polygon-limits-settings',
      partialize: (state) => ({ limits: state.limits, lastFetched: state.lastFetched }),
    }
  )
);

export const POLYGON_LIMIT_OPTIONS = [0, 50, 100, 200, 300, 400, 500, 1000];
export const ACCESS_LEVELS: AccessLevel[] = ['very_low', 'intermediate', 'manager', 'expert'];
export const ACCESS_LEVEL_LABELS: Record<AccessLevel, string> = {
  very_low: 'Basic',
  intermediate: 'Intermediate', 
  manager: 'Manager',
  expert: 'Expert',
};
export type { AccessLevel };
