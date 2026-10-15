import { useCallback, useEffect, useRef } from "react";
import type { Feature, Map as OLMap } from "ol";
import type MapBrowserEvent from "ol/MapBrowserEvent";
import type { Geometry } from "ol/geom";
import type VectorLayer from "ol/layer/Vector";
import type VectorSource from "ol/source/Vector";

import { useModelStore } from "@/features/configurator/store/modelStore";
import { findBuildingLayer } from "@/features/configurator/hooks/useAreaSelect/helpers/layerConnections";
import { createBuildingHighlightStyleFunction, createBuildingStyleFunction } from "@/features/interactive-map/utils/mapStyleUtils";

/**
 * A disabled building stays in pylovo's grid but is left out of the BuEM run and the
 * simulation; the backend reads the same flag when it builds the topology
 * (backend/internal/payload/payload_topology_transform.go).
 */
export const isBuildingDisabled = (feature: Feature<Geometry>): boolean => feature.get("activated") === false;

const setDisabled = (feature: Feature<Geometry>, disabled: boolean) => {
  if (disabled) feature.set("activated", false);
  else feature.unset("activated");
};

const buildingFeatures = (layers: VectorLayer<VectorSource>[]): Feature<Geometry>[] =>
  findBuildingLayer(layers)?.getSource()?.getFeatures() ?? [];

const buildingAt = (map: OLMap, pixel: number[]): Feature<Geometry> | undefined =>
  map.forEachFeatureAtPixel(pixel, (f) => (f.get("feature_type") === "building" ? (f as Feature<Geometry>) : undefined));

const isTyping = (target: EventTarget | null): boolean => {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
};

interface BuildingSelectionOptions {
  map: OLMap | null;
  pylovoLayersRef: React.RefObject<VectorLayer<VectorSource>[]>;
  isDrawing: boolean;
  /** True when a polygon corner is under the pointer: Alt+click then deletes the corner instead. */
  cornerUnderPointerRef: React.RefObject<boolean>;
  onBuildingsChanged: () => void;
}

/**
 * Alt+click disables a building or enables it again. Ctrl+click (Cmd+click on macOS) adds a
 * building to the selection or takes it out; Delete disables the selection, Escape clears it.
 */
export const useBuildingSelection = ({ map, pylovoLayersRef, isDrawing, cornerUnderPointerRef, onBuildingsChanged }: BuildingSelectionOptions) => {
  // Another map tool (transformer placement, building assignment) owns clicks while it is active.
  const activeMode = useModelStore((s) => s.activeMode);
  const enabled = !isDrawing && activeMode === null;
  const selected = useModelStore((s) => s.selectedBuildingIds);
  const toggleSelection = useModelStore((s) => s.toggleBuildingSelection);
  const clearSelection = useModelStore((s) => s.clearBuildingSelection);
  const gridBuildings = useModelStore((s) => s.pylovoGridData?.buildings);

  // A regenerated grid replaces every building feature, so the old selection no longer matches what is drawn.
  useEffect(() => clearSelection(), [gridBuildings, clearSelection]);

  const highlighted = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const f of buildingFeatures(pylovoLayersRef.current)) {
      const id = String(f.get("osm_id"));
      const isSelected = selected.has(id);
      if (isSelected === highlighted.current.has(id)) continue;
      f.setStyle(isSelected ? createBuildingHighlightStyleFunction() : createBuildingStyleFunction(true, false));
    }
    highlighted.current = new Set(selected);
  }, [selected, pylovoLayersRef]);

  const disableSelected = useCallback(() => {
    const ids = useModelStore.getState().selectedBuildingIds;
    const features = buildingFeatures(pylovoLayersRef.current).filter((f) => ids.has(String(f.get("osm_id"))));
    if (features.length === 0) return;
    features.forEach((f) => setDisabled(f, true));
    clearSelection();
    onBuildingsChanged();
  }, [pylovoLayersRef, clearSelection, onBuildingsChanged]);

  useEffect(() => {
    if (!map || !enabled) return;
    const onClick = (evt: MapBrowserEvent) => {
      const e = evt.originalEvent as MouseEvent;
      const alt = e.altKey && !e.shiftKey && !e.ctrlKey && !e.metaKey;
      const pick = (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey;
      if (!alt && !pick) return;
      if (alt && cornerUnderPointerRef.current) return;
      const building = buildingAt(map, evt.pixel);
      if (!building) return;
      if (pick) {
        toggleSelection(String(building.get("osm_id")));
        return;
      }
      const disabled = !isBuildingDisabled(building);
      setDisabled(building, disabled);
      const { buildingTooltip, setBuildingTooltip } = useModelStore.getState();
      if (buildingTooltip) setBuildingTooltip({ ...buildingTooltip, disabled });
      onBuildingsChanged();
    };
    map.on("singleclick", onClick);
    return () => map.un("singleclick", onClick);
  }, [map, enabled, cornerUnderPointerRef, toggleSelection, onBuildingsChanged]);

  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (useModelStore.getState().selectedBuildingIds.size === 0 || isTyping(e.target)) return;
      if (e.key === "Delete") {
        e.preventDefault();
        disableSelected();
      } else if (e.key === "Escape") {
        clearSelection();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [enabled, disableSelected, clearSelection]);

  return { selectedCount: selected.size, disableSelected, clearSelection };
};
