import { createContext, useContext } from "react";
import type React from "react";

interface MapContextValue {
  zoomIn: () => void;
  zoomOut: () => void;
  centerMap: () => void;
  initMapInstance: () => Promise<void>;
  clearDrawingLayers: () => void;
  MapControls: React.FC;
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
