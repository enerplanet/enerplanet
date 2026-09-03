import { create } from "zustand";
import type { PylovoGridData, AdvancedParametersState } from "@/features/configurator/types/area-select";
import { getDefaultAdvancedParameters } from "@/features/configurator/constants/area-select-params";
import type { Technology } from "@/features/technologies/services/technologyService";
import type { CustomLocation } from "@/features/locations/services/customLocationService";

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

export type ActiveMode =
  | "add-transformer"
  | "move-transformer"
  | "assign-buildings"
  | "multi-edit"
  | "heat-link"
  | null;

export type HeatResolutionMode = "expected" | "manual";

export type AssignStep = "select-buildings" | "select-transformer";

export interface ModelStore {
  // ── Active mode (unified) ──
  activeMode: ActiveMode;
  setActiveMode: (mode: ActiveMode) => void;
  assignStep: AssignStep;
  setAssignStep: (step: AssignStep) => void;
 
  // ── Heat resolution (expected-fit auto-resolve / manual) ──
  heatResolutionMode: HeatResolutionMode;
  setHeatResolutionMode: (mode: HeatResolutionMode) => void;
  // One-time "how to add heat techs" bootstrap, shown once after grid data loads.
  heatBootstrapOpen: boolean;
  setHeatBootstrapOpen: (v: boolean) => void;
  heatBootstrapPrompted: boolean;
  setHeatBootstrapPrompted: (v: boolean) => void;

  // ── Grid / pylovo data ──
  pylovoGridData: PylovoGridData | undefined;
  setPylovoGridData: (data: PylovoGridData | undefined | ((prev: PylovoGridData | undefined) => PylovoGridData | undefined)) => void;
  isRunningPowerFlow: boolean;
  setIsRunningPowerFlow: (v: boolean) => void;
  powerFlowResults: Map<number, any>;
  setPowerFlowResults: (results: Map<number, any>) => void;

  // ── Polygon / drawing ──
  allPolygons: [number, number][][];
  setAllPolygons: (polygons: [number, number][][]) => void;
  isDrawing: boolean;
  setIsDrawing: (drawing: boolean) => void;
  allowMultiplePolygons: boolean;
  setAllowMultiplePolygons: (allow: boolean) => void;
  clearTrigger: number;
  incrementClearTrigger: () => void;
  cursorPos: { x: number; y: number } | null;
  setCursorPos: (pos: { x: number; y: number } | null) => void;

  // ── Model metadata ──
  modelName: string;
  setModelName: (name: string) => void;
  fromDate: string;
  setFromDate: (date: string) => void;
  toDate: string;
  setToDate: (date: string) => void;
  resolution: number;
  setResolution: (res: number) => void;

  // ── Loading / saving ──
  isSaving: boolean;
  setIsSaving: (v: boolean) => void;
  isLoadingModel: boolean;
  setIsLoadingModel: (v: boolean) => void;
  isGeneratingGrid: boolean;
  setIsGeneratingGrid: (v: boolean) => void;

  // ── Unsaved changes ──
  isModified: boolean;
  setIsModified: (v: boolean) => void;
  showUnsavedDialog: boolean;
  setShowUnsavedDialog: (v: boolean) => void;

  // ── Tour / advanced params ──
  showAreaSelectTour: boolean;
  setShowAreaSelectTour: (v: boolean) => void;
  showAdvancedParams: boolean;
  setShowAdvancedParams: (v: boolean) => void;
  advancedParams: AdvancedParametersState;
  setAdvancedParams: (params: AdvancedParametersState) => void;
  resetAdvancedParams: () => void;

  // ── Building filters ──
  includePublicBuildings: boolean;
  setIncludePublicBuildings: (v: boolean) => void;
  includePrivateBuildings: boolean;
  setIncludePrivateBuildings: (v: boolean) => void;
  excludedBuildingIds: Set<number>;
  toggleBuildingExclusion: (id: number) => void;
  clearExcludedBuildings: () => void;

  // ── Map interactions (dialogs + tooltips) ──
  transformerDialogOpen: boolean;
  setTransformerDialogOpen: (v: boolean) => void;
  selectedTransformer: any;
  setSelectedTransformer: (updater: any | ((prev: any) => any)) => void;
  transformerTooltip: any;
  setTransformerTooltip: (v: any) => void;
  buildingDialogOpen: boolean;
  setBuildingDialogOpen: (v: boolean) => void;
  selectedBuilding: any;
  setSelectedBuilding: (updater: any | ((prev: any) => any)) => void;
  selectedBuildingFeature: any;
  setSelectedBuildingFeature: (v: any) => void;
  buildingTooltip: any;
  setBuildingTooltip: (v: any) => void;
  mvLineTooltip: any;
  setMvLineTooltip: (v: any) => void;

  // ── Tech operations ──
  showTechDrawer: boolean;
  setShowTechDrawer: (v: boolean) => void;
  draggingTech: Technology | null;
  setDraggingTech: (v: Technology | null) => void;
  techDialogOpen: boolean;
  setTechDialogOpen: (v: boolean) => void;
  selectedTechForDialog: Technology | null;
  setSelectedTechForDialog: (v: Technology | null) => void;
  selectedBuildingForTech: any;
  setSelectedBuildingForTech: (v: any) => void;
  isAddingTechToAll: boolean;
  setIsAddingTechToAll: (v: boolean) => void;
  appliedTechKeys: string[];
  setAppliedTechKeys: (v: string[] | ((prev: string[]) => string[])) => void;

  // ── Custom locations ──
  customLocations: CustomLocation[];
  setCustomLocations: (v: CustomLocation[]) => void;
  customLocationsInPolygon: CustomLocation[];
  setCustomLocationsInPolygon: (v: CustomLocation[]) => void;

  // ── Region / boundary ──
  regionBoundary: { name: string; boundary: GeoJSON.Feature } | null;
  setRegionBoundary: (v: { name: string; boundary: GeoJSON.Feature } | null) => void;
  availableRegions: Array<{
    name: string;
    gridCount: number;
    country?: string;
    countryCode?: string;
    stateCode?: string;
    has3d?: boolean;
    bbox?: { west: number; south: number; east: number; north: number };
  }>;
  setAvailableRegions: (v: any[]) => void;
  showBoundary: boolean;
  toggleBoundary: () => void;
  availableBoundaryGeoJSON: GeoJSON.FeatureCollection | undefined;
  setAvailableBoundaryGeoJSON: (v: GeoJSON.FeatureCollection | undefined) => void;

  // ── Heat links (producer → consumer) ──
  selectedHeatLinkSource: string | null;
  setSelectedHeatLinkSource: (v: string | null) => void;

  // ── Selected buildings for assign mode ──
  selectedBuildingsForAssign: string[];
  setSelectedBuildingsForAssign: (ids: string[] | ((prev: string[]) => string[])) => void;
  reassignmentLineAnchor: [number, number] | null;
  setReassignmentLineAnchor: (v: [number, number] | null) => void;

  // ── Transformer add mode state ──
  newTransformerCoords: [number, number] | null;
  setNewTransformerCoords: (v: [number, number] | null) => void;
  addTransformerDialogOpen: boolean;
  setAddTransformerDialogOpen: (v: boolean) => void;
  transformerCursorPos: { x: number; y: number } | null;
  setTransformerCursorPos: (v: { x: number; y: number } | null) => void;

  // ── Transformer move mode state ──
  transformerToMove: number | null;
  setTransformerToMove: (v: number | null) => void;

  // ── Reset ──
  reset: () => void;
}

// ──────────────────────────────────────────────
// Store
// ──────────────────────────────────────────────

const getInitialState = () => ({
  activeMode: null as ActiveMode,
  assignStep: "select-buildings" as AssignStep,
  heatResolutionMode: "expected" as HeatResolutionMode,
  heatBootstrapOpen: false,
  heatBootstrapPrompted: false,
  pylovoGridData: undefined as PylovoGridData | undefined,
  isRunningPowerFlow: false,
  powerFlowResults: new Map<number, any>(),
  allPolygons: [] as [number, number][][],
  isDrawing: false,
  allowMultiplePolygons: false,
  clearTrigger: 0,
  cursorPos: null as { x: number; y: number } | null,
  modelName: "",
  fromDate: "",
  toDate: "",
  resolution: 60,
  isSaving: false,
  isLoadingModel: false,
  isGeneratingGrid: false,
  isModified: false,
  showUnsavedDialog: false,
  showAreaSelectTour: false,
  showAdvancedParams: false,
  advancedParams: getDefaultAdvancedParameters(),
  includePublicBuildings: true,
  includePrivateBuildings: true,
  excludedBuildingIds: new Set<number>(),
  transformerDialogOpen: false,
  selectedTransformer: null,
  transformerTooltip: null,
  buildingDialogOpen: false,
  selectedBuilding: null,
  selectedBuildingFeature: null,
  buildingTooltip: null,
  mvLineTooltip: null,
  showTechDrawer: false,
  draggingTech: null,
  techDialogOpen: false,
  selectedTechForDialog: null,
  selectedBuildingForTech: null,
  isAddingTechToAll: false,
  appliedTechKeys: [] as string[],
  customLocations: [],
  customLocationsInPolygon: [],
  regionBoundary: null as { name: string; boundary: GeoJSON.Feature } | null,
  availableRegions: [],
  showBoundary: true,
  availableBoundaryGeoJSON: undefined as GeoJSON.FeatureCollection | undefined,
  selectedHeatLinkSource: null as string | null,
  selectedBuildingsForAssign: [],
  reassignmentLineAnchor: null as [number, number] | null,
  newTransformerCoords: null as [number, number] | null,
  addTransformerDialogOpen: false,
  transformerCursorPos: null as { x: number; y: number } | null,
  transformerToMove: null as number | null,
});

export const useModelStore = create<ModelStore>((set) => ({
  ...getInitialState(),
  // ── Active mode ──
  activeMode: null,
  setActiveMode: (mode) => set({ activeMode: mode }),
  assignStep: "select-buildings",
  setAssignStep: (step) => set({ assignStep: step }),
  heatResolutionMode: "expected",
  setHeatResolutionMode: (mode) => set({ heatResolutionMode: mode }),
  heatBootstrapOpen: false,
  setHeatBootstrapOpen: (v) => set({ heatBootstrapOpen: v }),
  heatBootstrapPrompted: false,
  setHeatBootstrapPrompted: (v) => set({ heatBootstrapPrompted: v }),

  // ── Grid / pylovo data ──
  pylovoGridData: undefined,
  setPylovoGridData: (data) =>
    set((s) => ({
      pylovoGridData: typeof data === "function" ? (data as (prev: PylovoGridData | undefined) => PylovoGridData | undefined)(s.pylovoGridData) : data,
    })),
  isRunningPowerFlow: false,
  setIsRunningPowerFlow: (v) => set({ isRunningPowerFlow: v }),
  powerFlowResults: new Map(),
  setPowerFlowResults: (results) => set({ powerFlowResults: results }),

  // ── Polygon / drawing ──
  allPolygons: [],
  setAllPolygons: (polygons) => set({ allPolygons: polygons }),
  isDrawing: false,
  setIsDrawing: (drawing) => set({ isDrawing: drawing }),
  allowMultiplePolygons: false,
  setAllowMultiplePolygons: (allow) => set({ allowMultiplePolygons: allow }),
  clearTrigger: 0,
  incrementClearTrigger: () => set((s) => ({ clearTrigger: s.clearTrigger + 1 })),
  cursorPos: null,
  setCursorPos: (pos) => set({ cursorPos: pos }),

  // ── Model metadata ──
  modelName: "",
  setModelName: (name) => set({ modelName: name }),
  fromDate: "",
  setFromDate: (date) => set({ fromDate: date }),
  toDate: "",
  setToDate: (date) => set({ toDate: date }),
  resolution: 60,
  setResolution: (res) => set({ resolution: res }),

  // ── Loading / saving ──
  isSaving: false,
  setIsSaving: (v) => set({ isSaving: v }),
  isLoadingModel: false,
  setIsLoadingModel: (v) => set({ isLoadingModel: v }),
  isGeneratingGrid: false,
  setIsGeneratingGrid: (v) => set({ isGeneratingGrid: v }),

  // ── Unsaved changes ──
  isModified: false,
  setIsModified: (v) => set({ isModified: v }),
  showUnsavedDialog: false,
  setShowUnsavedDialog: (v) => set({ showUnsavedDialog: v }),

  // ── Tour / advanced params ──
  showAreaSelectTour: false,
  setShowAreaSelectTour: (v) => set({ showAreaSelectTour: v }),
  showAdvancedParams: false,
  setShowAdvancedParams: (v) => set({ showAdvancedParams: v }),
  advancedParams: getDefaultAdvancedParameters(),
  setAdvancedParams: (params) => set({ advancedParams: params }),
  resetAdvancedParams: () => set({ advancedParams: getDefaultAdvancedParameters() }),

  // ── Building filters ──
  includePublicBuildings: true,
  setIncludePublicBuildings: (v) => set({ includePublicBuildings: v }),
  includePrivateBuildings: true,
  setIncludePrivateBuildings: (v) => set({ includePrivateBuildings: v }),
  excludedBuildingIds: new Set(),
  toggleBuildingExclusion: (id) =>
    set((s) => {
      const next = new Set(s.excludedBuildingIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { excludedBuildingIds: next };
    }),
  clearExcludedBuildings: () => set({ excludedBuildingIds: new Set() }),

  // ── Map interactions ──
  transformerDialogOpen: false,
  setTransformerDialogOpen: (v) => set({ transformerDialogOpen: v }),
  selectedTransformer: null,
  setSelectedTransformer: (updater) =>
    set((s) => ({
      selectedTransformer:
        typeof updater === "function" ? updater(s.selectedTransformer) : updater,
    })),
  transformerTooltip: null,
  setTransformerTooltip: (v) => set({ transformerTooltip: v }),
  buildingDialogOpen: false,
  setBuildingDialogOpen: (v) => set({ buildingDialogOpen: v }),
  selectedBuilding: null,
  setSelectedBuilding: (updater) =>
    set((s) => ({
      selectedBuilding:
        typeof updater === "function" ? updater(s.selectedBuilding) : updater,
    })),
  selectedBuildingFeature: null,
  setSelectedBuildingFeature: (v) => set({ selectedBuildingFeature: v }),
  buildingTooltip: null,
  setBuildingTooltip: (v) => set({ buildingTooltip: v }),
  mvLineTooltip: null,
  setMvLineTooltip: (v) => set({ mvLineTooltip: v }),

  // ── Tech operations ──
  showTechDrawer: false,
  setShowTechDrawer: (v) => set({ showTechDrawer: v }),
  draggingTech: null,
  setDraggingTech: (v) => set({ draggingTech: v }),
  techDialogOpen: false,
  setTechDialogOpen: (v) => set({ techDialogOpen: v }),
  selectedTechForDialog: null,
  setSelectedTechForDialog: (v) => set({ selectedTechForDialog: v }),
  selectedBuildingForTech: null,
  setSelectedBuildingForTech: (v) => set({ selectedBuildingForTech: v }),
  isAddingTechToAll: false,
  setIsAddingTechToAll: (v) => set({ isAddingTechToAll: v }),
  appliedTechKeys: [],
  setAppliedTechKeys: (v) =>
    set((s) => ({
      appliedTechKeys: typeof v === "function" ? v(s.appliedTechKeys) : v,
    })),

  // ── Custom locations ──
  customLocations: [],
  setCustomLocations: (v) => set({ customLocations: v }),
  customLocationsInPolygon: [],
  setCustomLocationsInPolygon: (v) => set({ customLocationsInPolygon: v }),

  // ── Region / boundary ──
  regionBoundary: null,
  setRegionBoundary: (v) => set({ regionBoundary: v }),
  availableRegions: [],
  setAvailableRegions: (v) => set({ availableRegions: v }),
  showBoundary: true,
  toggleBoundary: () => set((s) => ({ showBoundary: !s.showBoundary })),
  availableBoundaryGeoJSON: undefined,
  setAvailableBoundaryGeoJSON: (v) => set({ availableBoundaryGeoJSON: v }),

  selectedHeatLinkSource: null as string | null,
  setSelectedHeatLinkSource: (v) => set({ selectedHeatLinkSource: v }),
  // ── Selected buildings for assign mode ──
  selectedBuildingsForAssign: [],
  setSelectedBuildingsForAssign: (ids) =>
    set((s) => ({
      selectedBuildingsForAssign:
        typeof ids === "function" ? (ids as (prev: string[]) => string[])(s.selectedBuildingsForAssign) : ids,
    })),
  reassignmentLineAnchor: null,
  setReassignmentLineAnchor: (v) => set({ reassignmentLineAnchor: v }),

  // ── Transformer add mode state ──
  newTransformerCoords: null,
  setNewTransformerCoords: (v) => set({ newTransformerCoords: v }),
  addTransformerDialogOpen: false,
  setAddTransformerDialogOpen: (v) => set({ addTransformerDialogOpen: v }),
  transformerCursorPos: null,
  setTransformerCursorPos: (v) => set({ transformerCursorPos: v }),

  // ── Transformer move mode state ──
  transformerToMove: null,
  setTransformerToMove: (v) => set({ transformerToMove: v }),

  // ── Reset ──
  reset: () => set(() => getInitialState()),
}));
