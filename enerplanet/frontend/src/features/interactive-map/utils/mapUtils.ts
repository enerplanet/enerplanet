export const MAP_ZOOM = {
  DEFAULT: 12,
  MIN: 1,
  MAX: 20,
} as const;

const MAP_INIT = {
  MAX_ATTEMPTS: 50,
  RETRY_DELAY: 100,
} as const;

/**
 * Shared map
 */
export const initializeMap = async (
  mapRef: React.RefObject<HTMLDivElement | null>, 
  initMapInstance: () => void | Promise<void>,
  onMutedStateChange?: (muted: boolean) => void
): Promise<void> => {
  onMutedStateChange?.(true);

  let attempts = 0;

  while (!mapRef.current && attempts < MAP_INIT.MAX_ATTEMPTS) {
    await new Promise((resolve) => setTimeout(resolve, MAP_INIT.RETRY_DELAY));
    attempts++;
  }

  if (mapRef.current) {
    try {
      await initMapInstance();
    } catch (err) {
      if (import.meta.env.DEV) console.warn('initializeMap: initMapInstance failed', err);
    }
  } else if (import.meta.env.DEV) {
    console.warn('Map initialization failed: mapRef not available after maximum attempts');
  }

  onMutedStateChange?.(false);
};
