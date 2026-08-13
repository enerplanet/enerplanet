import { useCallback, useEffect } from "react";
import type { Feature } from "ol";
import type { Geometry } from "ol/geom";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import type { Technology } from "@/features/technologies/services/technologyService";
import { useModelStore } from "@/features/configurator/store/modelStore";
import { createBuildingStyleFunction } from "@/features/interactive-map/utils/mapStyleUtils";
import { collectBuildingsFromLayers } from "@/features/configurator/hooks/useAreaSelect/helpers/layerConnections";

interface TechDragDropOptions {
  map: any;
  mapRef: React.RefObject<HTMLDivElement | null>;
  pylovoLayersRef: React.RefObject<VectorLayer<VectorSource>[]>;
  showSuccess: (msg: string) => void;
  showError: (msg: string) => void;
  t: (key: string, fallback?: any) => string;
  setIsModified: (v: boolean) => void;
}

export const useTechDragDrop = ({
  map, mapRef, pylovoLayersRef, showSuccess, showError, t, setIsModified,
}: TechDragDropOptions) => {
  const showTechDrawer = useModelStore((s) => s.showTechDrawer);
  const setShowTechDrawer = useModelStore((s) => s.setShowTechDrawer);
  const draggingTech = useModelStore((s) => s.draggingTech);
  const setDraggingTech = useModelStore((s) => s.setDraggingTech);
  const techDialogOpen = useModelStore((s) => s.techDialogOpen);
  const setTechDialogOpen = useModelStore((s) => s.setTechDialogOpen);
  const selectedTechForDialog = useModelStore((s) => s.selectedTechForDialog);
  const setSelectedTechForDialog = useModelStore((s) => s.setSelectedTechForDialog);
  const selectedBuildingForTech = useModelStore((s) => s.selectedBuildingForTech);
  const setSelectedBuildingForTech = useModelStore((s) => s.setSelectedBuildingForTech);
  const isAddingTechToAll = useModelStore((s) => s.isAddingTechToAll);
  const setIsAddingTechToAll = useModelStore((s) => s.setIsAddingTechToAll);
  const appliedTechKeys = useModelStore((s) => s.appliedTechKeys);
  const setAppliedTechKeys = useModelStore((s) => s.setAppliedTechKeys);

  const handleTechDragStart = useCallback((tech: Technology) => { setDraggingTech(tech); }, [setDraggingTech]);
  const handleTechDragEnd = useCallback(() => { setDraggingTech(null); }, [setDraggingTech]);

  const handleMapDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!map || !draggingTech) return;
    try {
      const mapElement = mapRef.current;
      if (!mapElement) return;
      const rect = mapElement.getBoundingClientRect();
      const pixel = [e.clientX - rect.left, e.clientY - rect.top];
      const feature = map.forEachFeatureAtPixel(pixel, (f: any) => f.get('feature_type') === 'building' ? f : null);
      if (feature) { setSelectedTechForDialog(draggingTech); setSelectedBuildingForTech(feature); setTechDialogOpen(true); }
      else showError(t("gridNotifications.dropOnBuilding"));
    } catch (error) { console.error("Error handling tech drop:", error); }
    finally { setDraggingTech(null); }
  }, [map, draggingTech, mapRef, showError, t, setSelectedTechForDialog, setSelectedBuildingForTech, setTechDialogOpen, setDraggingTech]);

  const handleMapDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    if (!map || !draggingTech) return;
    const mapElement = mapRef.current;
    if (!mapElement) return;
    const rect = mapElement.getBoundingClientRect();
    const pixel = [e.clientX - rect.left, e.clientY - rect.top];
    const feature = map.forEachFeatureAtPixel(pixel, (f: any) => f.get('feature_type') === 'building' ? f : null);
    // Highlight is handled inline via the feature's own style
  }, [map, draggingTech, mapRef]);

  const handleSaveTechToBuildingBulk = useCallback((techKey: string, constraints: { key: string; value: number | string }[], applyToAll: boolean = false) => {
    if (!selectedBuildingForTech || !selectedTechForDialog) return;
    if (applyToAll) {
      let count = 0;
      pylovoLayersRef.current.forEach((layer: any) => {
        const src = layer.getSource();
        if (src) src.getFeatures().forEach((f: Feature<Geometry>) => {
          if (f.get('feature_type') === 'building') {
            const existing = f.get("techs") || {};
            existing[techKey] = { alias: selectedTechForDialog.alias, icon: selectedTechForDialog.icon, constraints };
            f.set("techs", existing);
            f.setStyle(createBuildingStyleFunction(true, false));
            count++;
          }
        });
      });
      setAppliedTechKeys((prev) => prev.includes(techKey) ? prev : [...prev, techKey]);
      showSuccess(t("gridNotifications.techAddedToAll", { tech: selectedTechForDialog.alias, count }));
    } else {
      const existing = selectedBuildingForTech.get("techs") || {};
      existing[techKey] = { alias: selectedTechForDialog.alias, icon: selectedTechForDialog.icon, constraints };
      selectedBuildingForTech.set("techs", existing);
      selectedBuildingForTech.setStyle(createBuildingStyleFunction(true, false));
      showSuccess(t("gridNotifications.techAddedToBuilding", { tech: selectedTechForDialog.alias }));
    }
    setTechDialogOpen(false);
    setSelectedTechForDialog(null);
    setSelectedBuildingForTech(null);
    setIsAddingTechToAll(false);
    setIsModified(true);
  }, [selectedBuildingForTech, selectedTechForDialog, showSuccess, pylovoLayersRef, t, setIsModified, setTechDialogOpen, setSelectedTechForDialog, setSelectedBuildingForTech, setIsAddingTechToAll, setAppliedTechKeys]);

  const handleAddTechToAll = useCallback((tech: Technology) => {
    setSelectedTechForDialog(tech);
    setIsAddingTechToAll(true);
    let firstBuilding = null;
    for (const layer of pylovoLayersRef.current) {
      const src = layer.getSource();
      if (!src) continue;
      firstBuilding = src.getFeatures().find((f: Feature<Geometry>) => f.get('feature_type') === 'building');
      if (firstBuilding) break;
    }
    if (firstBuilding) { setSelectedBuildingForTech(firstBuilding); setTechDialogOpen(true); }
    else { showError(t("gridNotifications.noBuildingsFound")); setIsAddingTechToAll(false); }
  }, [showError, pylovoLayersRef, t, setSelectedTechForDialog, setIsAddingTechToAll, setSelectedBuildingForTech, setTechDialogOpen]);

  const handleRemoveTechFromAll = useCallback((tech: Technology) => {
    let count = 0;
    pylovoLayersRef.current.forEach((layer: any) => {
      const src = layer.getSource();
      if (src) src.getFeatures().forEach((f: Feature<Geometry>) => {
        if (f.get('feature_type') === 'building') {
          const existing = f.get("techs") || {};
          if (existing[tech.key]) { delete existing[tech.key]; f.set("techs", existing); f.setStyle(createBuildingStyleFunction(true, false)); count++; }
        }
      });
    });
    setAppliedTechKeys((prev) => prev.filter((k: string) => k !== tech.key));
    showSuccess(t("gridNotifications.techRemovedFromAll", { tech: tech.alias, count }));
    setIsModified(true);
  }, [showSuccess, pylovoLayersRef, t, setIsModified, setAppliedTechKeys]);

  const getAppliedTechKeys = useCallback((): string[] => {
    const counts: Record<string, number> = {};
    let bc = 0;
    for (const f of collectBuildingsFromLayers(pylovoLayersRef.current)) { bc++; const techs = f.get("techs") || {}; for (const key of Object.keys(techs)) counts[key] = (counts[key] || 0) + 1; }
    return Object.entries(counts).filter(([, c]) => c === bc && bc > 0).map(([k]) => k);
  }, [pylovoLayersRef]);

  useEffect(() => { if (showTechDrawer) setAppliedTechKeys(getAppliedTechKeys()); }, [showTechDrawer, getAppliedTechKeys, setAppliedTechKeys]);

  const handleEditTechFromDialog = useCallback(async (techKey: string, buildingFeature: Feature<Geometry>) => {
    try {
      const techs = await import("@/features/technologies/services/technologyService").then(m => m.default.getAll());
      const tech = techs.find((t: Technology) => t.key === techKey);
      if (tech) { setSelectedTechForDialog(tech); setSelectedBuildingForTech(buildingFeature); setTechDialogOpen(true); }
      else showError(t("gridNotifications.techNotFound", { tech: techKey }));
    } catch { showError(t("gridNotifications.techLoadFailed")); }
  }, [showError, t, setSelectedTechForDialog, setSelectedBuildingForTech, setTechDialogOpen]);

  const handleRemoveTechFromDialog = useCallback((techKey: string, buildingFeature: Feature<Geometry>) => {
    const current = buildingFeature.get("techs") || {};
    const existing = { ...current };
    const alias = existing[techKey]?.alias || techKey;
    delete existing[techKey];
    buildingFeature.set("techs", existing);
    buildingFeature.setStyle(createBuildingStyleFunction(true, false));
    showSuccess(t("gridNotifications.techRemovedFromBuilding", { tech: alias }));
    setIsModified(true);
    return existing;
  }, [showSuccess, t, setIsModified]);

  return {
    showTechDrawer, setShowTechDrawer, draggingTech, handleTechDragStart, handleTechDragEnd,
    handleMapDrop, handleMapDragOver, techDialogOpen, setTechDialogOpen,
    selectedTechForDialog, selectedBuildingForTech, setSelectedBuildingForTech,
    handleSaveTechToBuildingBulk, isAddingTechToAll, setIsAddingTechToAll,
    handleAddTechToAll, handleRemoveTechFromAll, appliedTechKeys,
    handleEditTechFromDialog, handleRemoveTechFromDialog, setSelectedTechForDialog,
  };
};
