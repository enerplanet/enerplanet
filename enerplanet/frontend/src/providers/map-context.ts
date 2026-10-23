import { createContext, useContext } from "react";
import type React from "react";
import type { MapControlsPlacement } from "@/components/map-controls/MapControls";

interface MapContextValue {
  zoomIn: () => void;
  zoomOut: () => void;
  centerMap: () => void;
  initMapInstance: () => Promise<void>;
  clearDrawingLayers: () => void;
  MapControls: React.FC<{ placement?: MapControlsPlacement }>;
  mapRef: React.RefObject<HTMLDivElement | null>;
}

export const MapContext = createContext<MapContextValue | undefined>(undefined);

export function useMapProvider(): MapContextValue {
  const context = useContext(MapContext);
  if (context === undefined) {
    throw new Error("useMapProvider must be used within an MapContext");
  }
  return context;
}
