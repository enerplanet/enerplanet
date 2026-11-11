import { useCallback, useEffect, useRef, useState } from "react";
import type { Feature } from "ol";
import type { Geometry } from "ol/geom";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import { getCenter } from "ol/extent";
import { toLonLat, type ProjectionLike } from "ol/proj";
import { moduleOf } from "@/features/configurator/building-config/pvProducts";
import type { Technology } from "@/features/technologies/services/technologyService";
import { useModelStore } from "@/features/configurator/store/modelStore";
import { createBuildingHighlightStyleFunction, createBuildingStyleFunction } from "@/features/interactive-map/utils/mapStyleUtils";
import { collectBuildingsFromLayers } from "@/features/configurator/hooks/useAreaSelect/helpers/layerConnections";
import { HEAT_SUPPLY_TYPES, asBuildingTechnology, defaultProduct, loadCatalogue } from "@/features/technologies/catalogue";
import { hasHeatTech } from "@/features/configurator/utils/heatResolution";
import { useConfiguratorParams } from "@/features/configurator/building-config/useConfiguratorParams";
import { fetchBestFitArrays, type BuildingPlace } from "@/features/configurator/building-config/pvBestFit";
import { DEFAULT_USABLE_SHARE, type PvArray } from "@/features/configurator/building-config/usePvMode";
import { forEachLimited } from "@/components/map-controls/maplibre/useLod2Surfaces";

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

/** The product a building's technology entry names; an entry without one uses the type's default product, keyed by the type. */
const productOf = (type: string, entry: { product?: string } | undefined): string => entry?.product ?? type;

/** Keys of the products present on at least one of the buildings. */
export const productsInUse = (buildings: Feature<Geometry>[]): string[] => {
  const keys = new Set<string>();
  for (const f of buildings) for (const [type, entry] of Object.entries(f.get("techs") || {})) keys.add(productOf(type, entry as { product?: string }));
  return [...keys];
};

/** Removes the technology from the buildings that carry this product of it; returns how many. */
export const removeProduct = (buildings: Feature<Geometry>[], tech: { key: string; product?: string }): number => {
  const product = tech.product ?? tech.key;
  let count = 0;
  for (const f of buildings) {
    const existing = f.get("techs") || {};
    if (!existing[tech.key] || productOf(tech.key, existing[tech.key]) !== product) continue;
    const { [tech.key]: _removed, ...rest } = existing;
    f.set("techs", rest);
    f.setStyle(createBuildingStyleFunction(true, false));
    count++;
  }
  return count;
};

/** For a heat supply added to many buildings: only those without one, or all with theirs replaced. */
export type HeatScope = "missing" | "replace";

/**
 * Puts the technology entry on buildings and returns how many got it. A building
 * has one heat supply, so for a heat supply technology scope decides: "missing"
 * skips buildings that have one, "replace" removes their other heat technologies
 * and heat link first, and a building the analysis found not heated gets none.
 * Other technologies go on every building.
 */
export const applyToBuildings = (
  buildings: Feature<Geometry>[], techKey: string, entry: Record<string, unknown>, scope: HeatScope = "replace",
): number => {
  const heat = HEAT_SUPPLY_TYPES.includes(techKey);
  let count = 0;
  for (const f of buildings) {
    if (heat && (f.get("heated") === false || (scope === "missing" && hasHeatSupply(f)))) continue;
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

/**
 * Stores best-fit PV arrays, at one usable share and with the module of each
 * building's PV product, on each of the buildings that carries PV, and returns
 * how many could not be laid out. Those keep automatic placement, which the
 * backend sizes by roof area.
 */
export const layOutPv = async (buildings: Feature<Geometry>[], usableShare: number, projection: ProjectionLike): Promise<number> => {
  let country: string | null = null;
  let failed = 0;
  await forEachLimited(buildings, async (f) => {
    const osmId = String(f.get("osm_id"));
    const extent = f.getGeometry()?.getExtent();
    const point = extent && toLonLat(getCenter(extent), projection);
    const place: BuildingPlace | null = country ? { country } : point ? { lon: point[0], lat: point[1] } : null;
    if (!place) { failed++; return; }
    try {
      const result = await fetchBestFitArrays(osmId, place, usableShare, moduleOf(f.get("techs")?.pv_supply?.constraints));
      country = result.country;
      const techs = f.get("techs");
      if (techs?.pv_supply) f.set("techs", { ...techs, pv_supply: { ...techs.pv_supply, arrays: result.arrays } });
    } catch (err) {
      console.warn(`[pv] no best-fit layout for building ${osmId}`, err);
      failed++;
    }
  }, () => false);
  return failed;
};

/**
 * A technology as one building stores it when added. Arrays chosen in PV mode
 * outlive a later edit of the parameters. PV added in the building's 3D view
 * starts on no surface, for the user to place; elsewhere it gets the best fit.
 */
export const addedTech = (
  techKey: string,
  entry: Record<string, unknown>,
  stored: { arrays?: PvArray[] | null } | undefined,
  inView: boolean,
): Record<string, unknown> => {
  const arrays = stored?.arrays ?? (techKey === "pv_supply" && inView ? [] : undefined);
  return { ...entry, ...(arrays && { arrays }) };
};

/** The buildings a drop applies to: the whole selection when the drop lands on a selected building, else the dropped one. */
export const dropTargets = (dropped: Feature<Geometry>, selected: Set<string>, buildings: Feature<Geometry>[]): Feature<Geometry>[] =>
  selected.has(String(dropped.get("osm_id"))) && selected.size > 1
    ? buildings.filter((f) => selected.has(String(f.get("osm_id"))))
    : [dropped];

/**
 * Adds the technology to each building, keeping a selected building highlighted,
 * and returns the buildings whose new PV still needs a layout.
 */
const addToBuildings = (
  buildings: Feature<Geometry>[],
  techKey: string,
  entry: Record<string, unknown>,
  openBuildingId: string | null,
  selected: Set<string>,
): Feature<Geometry>[] =>
  buildings.filter((building) => {
    // A new object, so the open building configurator sees the change.
    const existing = { ...(building.get("techs") || {}) };
    const id = String(building.get("osm_id"));
    existing[techKey] = addedTech(techKey, entry, existing[techKey], openBuildingId === id);
    building.set("techs", existing);
    building.setStyle(selected.has(id) ? createBuildingHighlightStyleFunction() : createBuildingStyleFunction(true, false));
    return techKey === "pv_supply" && !existing[techKey].arrays;
  });

const ADDED_TO_ALL = "gridNotifications.techAddedToAll";

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
  const { buildingId: openBuildingId } = useConfiguratorParams();
  const [heatScopeRequest, setHeatScopeRequest] = useState<HeatScopeRequest | null>(null);

  // Set by a drop, read when its product is applied.
  const dropTargetsRef = useRef<Feature<Geometry>[] | null>(null);

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
      if (feature) {
        dropTargetsRef.current = dropTargets(feature, useModelStore.getState().selectedBuildingIds, collectBuildingsFromLayers(pylovoLayersRef.current));
        setSelectedTechForDialog(draggingTech); setSelectedBuildingForTech(feature); setTechDialogStep("pick"); setTechDialogOpen(true);
      }
      else showError(t("gridNotifications.dropOnBuilding"));
    } catch (error) { console.error("Error handling tech drop:", error); }
    finally { setDraggingTech(null); }
  }, [map, draggingTech, mapRef, pylovoLayersRef, showError, t, setSelectedTechForDialog, setSelectedBuildingForTech, setTechDialogOpen, setTechDialogStep, setDraggingTech]);

  const handleMapDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    if (!map || !draggingTech) return;
    const mapElement = mapRef.current;
    if (!mapElement) return;
    // Highlight is handled inline via the feature's own style
  }, [map, draggingTech, mapRef]);

  /** Lays out PV on the buildings and reports those it could not; then runs done. */
  const layOutPvAndReport = useCallback((buildings: Feature<Geometry>[], usableShare: number, done?: () => void) => {
    void layOutPv(buildings, usableShare, map?.getView().getProjection() ?? "EPSG:3857").then((failed) => {
      if (failed > 0) showError(t("gridNotifications.pvLayoutFailed", { count: failed }));
      setIsModified(true);
      done?.();
    });
  }, [map, showError, t, setIsModified]);

  /** Adds the technology to the buildings of the last drop on this building, else to the building alone, without opening it. */
  const addToDropTargets = useCallback((building: Feature<Geometry>, techKey: string, entry: { alias: string } & Record<string, unknown>, usableShare: number) => {
    const dropped = dropTargetsRef.current;
    const targets = dropped?.includes(building) ? dropped : [building];
    const toLayOut = addToBuildings(targets, techKey, entry, openBuildingId, useModelStore.getState().selectedBuildingIds);
    showSuccess(targets.length > 1
      ? t(ADDED_TO_ALL, { tech: entry.alias, count: targets.length })
      : t("gridNotifications.techAddedToBuilding", { tech: entry.alias }));
    if (toLayOut.length > 0) layOutPvAndReport(toLayOut, usableShare);
  }, [openBuildingId, showSuccess, t, layOutPvAndReport]);

  const handleSaveTechToBuildingBulk = useCallback((techKey: string, constraints: { key: string; value: number | string }[], applyToAll: boolean = false, product?: Technology, usableShare: number = DEFAULT_USABLE_SHARE) => {
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
        showSuccess(t(ADDED_TO_ALL, { tech: source.alias, count }));
        if (techKey === "pv_supply") layOutPvAndReport(buildings, usableShare);
      }
    } else {
      addToDropTargets(selectedBuildingForTech, techKey, entry, usableShare);
    }
    dropTargetsRef.current = null;
    setTechDialogOpen(false);
    setSelectedTechForDialog(null);
    setSelectedBuildingForTech(null);
    setIsAddingTechToAll(false);
    setIsModified(true);
  }, [selectedBuildingForTech, selectedTechForDialog, showSuccess, pylovoLayersRef, t, setIsModified, setTechDialogOpen, setSelectedTechForDialog, setSelectedBuildingForTech, setIsAddingTechToAll, layOutPvAndReport, addToDropTargets]);

  /** Applies the waiting heat supply to the chosen buildings, or drops it when scope is null. */
  const resolveHeatScope = useCallback((scope: HeatScope | null) => {
    const request = heatScopeRequest;
    setHeatScopeRequest(null);
    if (!request || !scope) return;
    const count = applyToBuildings(collectBuildingsFromLayers(pylovoLayersRef.current), request.techKey, request.entry, scope);
    showSuccess(t(ADDED_TO_ALL, { tech: request.alias, count }));
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
    const count = removeProduct(collectBuildingsFromLayers(pylovoLayersRef.current), tech);
    showSuccess(t("gridNotifications.techRemovedFromAll", { tech: tech.alias, count }));
    setIsModified(true);
  }, [showSuccess, pylovoLayersRef, t, setIsModified]);

  // Follows every building edit while the drawer is open, whichever path made it.
  useEffect(() => {
    if (!showTechDrawer) return;
    const refresh = () => setAppliedTechKeys(productsInUse(collectBuildingsFromLayers(pylovoLayersRef.current)));
    refresh();
    const sources = pylovoLayersRef.current.map((layer) => layer.getSource()).filter((s): s is VectorSource => s !== null);
    for (const s of sources) s.on("changefeature", refresh);
    return () => { for (const s of sources) s.un("changefeature", refresh); };
  }, [showTechDrawer, pylovoLayersRef, setAppliedTechKeys]);

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
    dropTargetsRef.current = null;
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
