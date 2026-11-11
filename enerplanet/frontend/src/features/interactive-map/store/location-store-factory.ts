import { useAuthStore } from '@/store/auth-store';

/**
 * Generic location interface for map and weather stores
 */
export interface BaseLocation {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  zoom?: number;
  source?: string;
}

/**
 * Check if user is authenticated
 */
export const isAuthenticated = (): boolean => {
  return !!useAuthStore.getState().user;
};

/**
 * Generate a location ID from coordinates
 */
const generateLocationId = (prefix: string, lat: number, lon: number): string => {
  return `${prefix}-${lat.toFixed(4)},${lon.toFixed(4)}`;
};

/**
 * Normalize a location with ID and source
 */
const normalizeLocation = <T extends BaseLocation>(
  loc: T,
  idPrefix: string
): T => {
  const id = loc.id || generateLocationId(idPrefix, loc.latitude, loc.longitude);
  return { ...loc, id, source: loc.source || 'custom' };
};

/**
 * Handle adding a location to the list
 */
export const addLocationToList = <T extends BaseLocation>(
  loc: T,
  existing: T[],
  idPrefix: string
): { normalized: T; next: T[] } => {
  const normalized = normalizeLocation(loc, idPrefix);
  const next = existing.some(l => l.id === normalized.id)
    ? existing.map(l => (l.id === normalized.id ? normalized : l))
    : [...existing, normalized];
  return { normalized, next };
};

/**
 * Handle removing a location from the list
 */
export const removeLocationFromList = <T extends BaseLocation>(
  id: string,
  current: T,
  savedLocations: T[],
  defaultLocation: T
): { remaining: T[]; nextLocation: T } => {
  const remaining = savedLocations.filter(l => l.id !== id);
  
  let nextLocation: T;
  if (current.id === id) {
    nextLocation = remaining.length > 0 ? remaining[0] : defaultLocation;
  } else {
    nextLocation = current;
  }
  
  return { remaining, nextLocation };
};
