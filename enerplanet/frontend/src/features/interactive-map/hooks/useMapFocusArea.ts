import { useEffect } from 'react';
import { useMapStore } from '@/features/interactive-map/store/map-store';
import { lonLatPoints } from '@/features/interactive-map/utils/mapFocus';

/** Makes the centre button fit this page's model area (any nesting of [lon, lat] pairs) while the page is mounted. */
export function useMapFocusArea(coordinates: unknown) {
  const setFocusArea = useMapStore((s) => s.setFocusArea);
  useEffect(() => {
    setFocusArea(lonLatPoints(coordinates));
    return () => setFocusArea([]);
  }, [coordinates, setFocusArea]);
}
