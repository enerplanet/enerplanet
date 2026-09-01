// ──────────────────────────────────────────────
// Barrel file — re-exports all configurator hooks
// ──────────────────────────────────────────────

export { useAddTransformerMode, useMoveTransformerMode } from "./useTransformerMode";
export type { AddTransformerModeState, MoveTransformerModeState } from "./useTransformerMode";

export { useAreaSelect, type AreaData } from "./useAreaSelect";

export { useBuildingAssignMode } from "./useBuildingAssignMode";
export type { BuildingAssignModeState } from "./useBuildingAssignMode";

export { useBuildingDemandRecalculation } from "./useBuildingDemandRecalculation";
export type { BuildingDemandHandlers } from "./useBuildingDemandRecalculation";

export { useMapResize, useReassignmentLine, useMapLibre3DHandlers } from "./useMapDisplay";

export { useMultiEditMode } from "./useMultiEditMode";
export type { MultiEditModeState } from "./useMultiEditMode";

export { useRegionName, useRegionSelection } from "./useRegion";

export { useTechDialogFlow } from "./useTechDialogFlow";

export { useTransformerActions } from "./useTransformerActions";

// Extracted internal hooks
export { useCustomLocationLayers } from "./useCustomLocationLayers";
export { usePylovoLayers } from "./usePylovoLayers";
export { useTechDragDrop } from "./useTechDragDrop";
export { useMapClickHandlers } from "./useMapClickHandlers";

// Store
export { useModelStore } from "@/features/configurator/store/modelStore";
export type { ActiveMode, ModelStore } from "@/features/configurator/store/modelStore";
