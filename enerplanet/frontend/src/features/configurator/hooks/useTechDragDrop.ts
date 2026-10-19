import { useCallback, useEffect, useState } from "react";
import type { Feature } from "ol";
import type { Geometry } from "ol/geom";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import type { Technology } from "@/features/technologies/services/technologyService";
import { useModelStore } from "@/features/configurator/store/modelStore";
import { createBuildingStyleFunction } from "@/features/interactive-map/utils/mapStyleUtils";
import { collectBuildingsFromLayers } from "@/features/configurator/hooks/useAreaSelect/helpers/layerConnections";
import { HEAT_SUPPLY_TYPES, asBuildingTechnology, defaultProduct, loadCatalogue } from "@/features/technologies/catalogue";
import { hasHeatTech } from "@/features/configurator/utils/heatResolution";
import { useConfiguratorParams } from "@/features/configurator/building-config/useConfiguratorParams";

/** Whether a building carries any technology or a heat link to a producer. */
const hasTechs = (f: Feature<Geometry>): boolean =>
  Object.keys(f.get("techs") || {}).length > 0 || Boolean(f.get("heat_supplier"));

/**
 * Removes every technology and heat link from buildings and returns how many
 * changed. Heat links go too: their producer has no heat technology left, and a
 * linked building is skipped by automatic heat assignment.
 */
export const clearTechs = (buildings: Feature<Geometry>[]): number => {
  let count = 0;
  for (const f of buildings) {
    if (!hasTechs(f)) continue;
    f.set("techs", {});
    f.unset("heat_supplier");
    f.setStyle(createBuildingStyleFunction(true, false));
    count++;
  }
  return count;
};

/** Whether a building has its heat supply: a heat technology or a link to a producer's. */
export const hasHeatSupply = (f: Feature<Geometry>): boolean => hasHeatTech(f.get("techs")) || Boolean(f.get("heat_supplier"));

/** For a heat supply added to many buildings: only those without one, or all with theirs replaced. */
export type HeatScope = "missing" | "replace";

/**
 * Puts the technology entry on buildings and returns how many got it. A building
 * has one heat supply, so for a heat supply technology scope decides: "missing"
 * skips buildings that have one, "replace" removes their other heat technologies
 * and heat link first. Other technologies go on every building.
 */
export const applyToBuildings = (
  buildings: Feature<Geometry>[], techKey: string, entry: Record<string, unknown>, scope: HeatScope = "replace",
): number => {
  const heat = HEAT_SUPPLY_TYPES.includes(techKey);
  let count = 0;
  for (const f of buildings) {
    if (heat && scope === "missing" && hasHeatSupply(f)) continue;
    const techs = { ...(f.get("techs") || {}) };
    if (heat && scope === "replace") {
      for (const key of HEAT_SUPPLY_TYPES) delete techs[key];
      f.unset("heat_supplier");
    }
    techs[techKey] = { ...entry };
    f.set("techs", techs);
    f.setStyle(createBuildingStyleFunction(true, false));
    count++;
  }
  return count;
};

/** A heat supply waiting for the user to choose which buildings it goes on. */
export interface HeatScopeRequest {
  techKey: string;
  alias: string;
  entry: Record<string, unknown>;
  withHeat: number;
  total: number;
}

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
  const techDialogStep = useModelStore((s) => s.techDialogStep);
  const setTechDialogStep = useModelStore((s) => s.setTechDialogStep);
  const selectedTechForDialog = useModelStore((s) => s.selectedTechForDialog);
  const setSelectedTechForDialog = useModelStore((s) => s.setSelectedTechForDialog);
  const selectedBuildingForTech = useModelStore((s) => s.selectedBuildingForTech);
  const setSelectedBuildingForTech = useModelStore((s) => s.setSelectedBuildingForTech);
  const isAddingTechToAll = useModelStore((s) => s.isAddingTechToAll);
  const setIsAddingTechToAll = useModelStore((s) => s.setIsAddingTechToAll);
  const appliedTechKeys = useModelStore((s) => s.appliedTechKeys);
  const setAppliedTechKeys = useModelStore((s) => s.setAppliedTechKeys);
  const { openBuilding } = useConfiguratorParams();
  const [heatScopeRequest, setHeatScopeRequest] = useState<HeatScopeRequest | null>(null);

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
      if (feature) { setSelectedTechForDialog(draggingTech); setSelectedBuildingForTech(feature); setTechDialogStep("pick"); setTechDialogOpen(true); }
      else showError(t("gridNotifications.dropOnBuilding"));
    } catch (error) { console.error("Error handling tech drop:", error); }
    finally { setDraggingTech(null); }
  }, [map, draggingTech, mapRef, showError, t, setSelectedTechForDialog, setSelectedBuildingForTech, setTechDialogOpen, setTechDialogStep, setDraggingTech]);

  const handleMapDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    if (!map || !draggingTech) return;
    const mapElement = mapRef.current;
    if (!mapElement) return;
    // Highlight is handled inline via the feature's own style
  }, [map, draggingTech, mapRef]);

  const handleSaveTechToBuildingBulk = useCallback((techKey: string, constraints: { key: string; value: number | string }[], applyToAll: boolean = false, product?: Technology) => {
    const source = product ?? selectedTechForDialog;
    if (!selectedBuildingForTech || !source) return;
    const entry = { alias: source.alias, icon: source.icon, constraints, ...(source.product && { product: source.product }) };
    if (applyToAll) {
      const buildings = collectBuildingsFromLayers(pylovoLayersRef.current);
      const withHeat = HEAT_SUPPLY_TYPES.includes(techKey) ? buildings.filter(hasHeatSupply).length : 0;
      if (withHeat > 0) {
        setHeatScopeRequest({ techKey, alias: source.alias, entry, withHeat, total: buildings.length });
      } else {
        const count = applyToBuildings(buildings, techKey, entry);
        setAppliedTechKeys((prev) => prev.includes(techKey) ? prev : [...prev, techKey]);
        showSuccess(t("gridNotifications.techAddedToAll", { tech: source.alias, count }));
      }
    } else {
      const existing = selectedBuildingForTech.get("techs") || {};
      // Arrays chosen in PV mode outlive a later edit of the parameters.
      const arrays = existing[techKey]?.arrays;
      existing[techKey] = { ...entry, ...(arrays && { arrays }) };
      selectedBuildingForTech.set("techs", existing);
      selectedBuildingForTech.setStyle(createBuildingStyleFunction(true, false));
      showSuccess(t("gridNotifications.techAddedToBuilding", { tech: source.alias }));
      // PV on one building continues in the 3D view, where its surfaces are chosen.
      if (techKey === "pv_supply") openBuilding(String(selectedBuildingForTech.get("osm_id")), { pv: true });
    }
    setTechDialogOpen(false);
    setSelectedTechForDialog(null);
    setSelectedBuildingForTech(null);
    setIsAddingTechToAll(false);
    setIsModified(true);
  }, [selectedBuildingForTech, selectedTechForDialog, showSuccess, pylovoLayersRef, t, setIsModified, setTechDialogOpen, setSelectedTechForDialog, setSelectedBuildingForTech, setIsAddingTechToAll, setAppliedTechKeys, openBuilding]);

  /** Applies the waiting heat supply to the chosen buildings, or drops it when scope is null. */
  const resolveHeatScope = useCallback((scope: HeatScope | null) => {
    const request = heatScopeRequest;
    setHeatScopeRequest(null);
    if (!request || !scope) return;
    const count = applyToBuildings(collectBuildingsFromLayers(pylovoLayersRef.current), request.techKey, request.entry, scope);
    showSuccess(t("gridNotifications.techAddedToAll", { tech: request.alias, count }));
    setIsModified(true);
  }, [heatScopeRequest, pylovoLayersRef, showSuccess, t, setIsModified]);

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
    if (firstBuilding) { setSelectedBuildingForTech(firstBuilding); setTechDialogStep("pick"); setTechDialogOpen(true); }
    else { showError(t("gridNotifications.noBuildingsFound")); setIsAddingTechToAll(false); }
  }, [showError, pylovoLayersRef, t, setSelectedTechForDialog, setIsAddingTechToAll, setSelectedBuildingForTech, setTechDialogOpen, setTechDialogStep]);

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

  const [techBuildingCount, setTechBuildingCount] = useState(0);
  useEffect(() => {
    if (showTechDrawer) setTechBuildingCount(collectBuildingsFromLayers(pylovoLayersRef.current).filter(hasTechs).length);
  }, [showTechDrawer, appliedTechKeys, pylovoLayersRef]);

  const handleRemoveAllTechs = useCallback(() => {
    const count = clearTechs(collectBuildingsFromLayers(pylovoLayersRef.current));
    setAppliedTechKeys([]);
    setTechBuildingCount(0);
    showSuccess(t("gridNotifications.allTechsRemoved", { count }));
    setIsModified(true);
  }, [pylovoLayersRef, setAppliedTechKeys, showSuccess, t, setIsModified]);

  const handleEditTechFromDialog = useCallback(async (techKey: string, buildingFeature: Feature<Geometry>) => {
    try {
      const catalogue = await loadCatalogue();
      const stored = buildingFeature.get("techs")?.[techKey]?.product;
      const tech = catalogue.find((p: Technology) => p.key === stored) ?? defaultProduct(catalogue, techKey);
      if (tech) { setSelectedTechForDialog(asBuildingTechnology(tech)); setSelectedBuildingForTech(buildingFeature); setTechDialogStep("define"); setTechDialogOpen(true); }
      else showError(t("gridNotifications.techNotFound", { tech: techKey }));
    } catch { showError(t("gridNotifications.techLoadFailed")); }
  }, [showError, t, setSelectedTechForDialog, setSelectedBuildingForTech, setTechDialogOpen, setTechDialogStep]);

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
    handleMapDrop, handleMapDragOver, techDialogOpen, setTechDialogOpen, techDialogStep, setTechDialogStep,
    selectedTechForDialog, selectedBuildingForTech, setSelectedBuildingForTech,
    handleSaveTechToBuildingBulk, isAddingTechToAll, setIsAddingTechToAll,
    handleAddTechToAll, handleRemoveTechFromAll, appliedTechKeys,
    heatScopeRequest, resolveHeatScope,
    handleRemoveAllTechs, techBuildingCount,
    handleEditTechFromDialog, handleRemoveTechFromDialog, setSelectedTechForDialog,
  };
};
