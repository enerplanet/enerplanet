import { useCallback, useEffect, useState } from "react";
import { transformExtent } from "ol/proj";
import type { Map as OLMap } from "ol";
import { generateUUID } from "@/utils/uuid";
import { highlightSelectedRegionBoundary } from "@/features/configurator/utils/gridLayerUtils";
import { useModelStore } from "@/features/configurator/store/modelStore";

// ──────────────────────────────────────────────
// useRegionName
// ──────────────────────────────────────────────

export const useRegionName = (allPolygons: [number, number][][]) => {
  const [regionName, setRegionName] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (allPolygons.length === 0) {
      setRegionName(undefined);
      return;
    }
    const allCoords = allPolygons.flatMap((poly) => poly);
    if (allCoords.length === 0) return;

    const sumLon = allCoords.reduce((sum, coord) => sum + coord[0], 0);
    const sumLat = allCoords.reduce((sum, coord) => sum + coord[1], 0);
    const centroidLon = sumLon / allCoords.length;
    const centroidLat = sumLat / allCoords.length;

    fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${centroidLat}&lon=${centroidLon}&zoom=10`
    )
      .then((res) => res.json())
      .then((data) => {
        const address = data.address;
        const city =
          address?.city ||
          address?.town ||
          address?.village ||
          address?.municipality ||
          address?.county;
        const country = address?.country;
        if (city && country) {
          setRegionName(`${city}, ${country}`);
        } else if (country) {
          setRegionName(country);
        }
      })
      .catch(() => { });
  }, [allPolygons]);

  return regionName;
};

// ──────────────────────────────────────────────
// useRegionSelection
// ──────────────────────────────────────────────

interface RegionSelectionOptions {
  map: OLMap | null;
  editMode: boolean;
  handleClearAllPolygons: () => void;
  resetAddTransformerMode: () => void;
  clearBuildingAssignMode: () => void;
  setDraftId: (id: string) => void;
}

export const useRegionSelection = ({
  map,
  editMode,
  handleClearAllPolygons,
  resetAddTransformerMode,
  clearBuildingAssignMode,
  setDraftId,
}: RegionSelectionOptions) => {
  const availableRegions = useModelStore((s) => s.availableRegions);
  const handleClearAllWithModes = useCallback(() => {
    handleClearAllPolygons();
    resetAddTransformerMode();
    clearBuildingAssignMode();
    if (!editMode) {
      setDraftId(generateUUID());
    }
  }, [
    handleClearAllPolygons,
    resetAddTransformerMode,
    clearBuildingAssignMode,
    editMode,
    setDraftId,
  ]);

  const handleRegionSelect = useCallback(
    (region: {
      name?: string;
      bbox?: { west: number; south: number; east: number; north: number };
    }) => {
      if (!map || !region.bbox) return;
      handleClearAllWithModes();
      const { west, south, east, north } = region.bbox;
      const extent = transformExtent([west, south, east, north], "EPSG:4326", "EPSG:3857");
      map.getView().fit(extent, {
        padding: [60, 60, 60, 60],
        duration: 1500,
        maxZoom: 14,
        easing: (t: number) => t * (2 - t),
      });
      const selectedName = region.name || null;
      highlightSelectedRegionBoundary(map, selectedName);
    },
    [map, handleClearAllWithModes]
  );

  const handleBoundaryRegionClick = useCallback(
    (regionName: string) => {
      const region = availableRegions?.find(
        (r: { name: string }) => r.name.toLowerCase() === regionName.toLowerCase()
      );
      if (region) handleRegionSelect(region);
    },
    [availableRegions, handleRegionSelect]
  );

  return { handleClearAllWithModes, handleRegionSelect, handleBoundaryRegionClick };
};
