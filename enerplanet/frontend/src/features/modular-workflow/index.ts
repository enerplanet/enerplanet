// ---------------------------------------------------------------------------
// Modular Workflow — public API exports
// ---------------------------------------------------------------------------

// Types
export type {
  ConfiguratorContext,
  DataSource,
  DataSources,
  GridStatistics,
  PowerFlowResponse,
  HostingCapacityResult,
  CostBreakdownItem,
  BuildingEnergyEstimate,
  GridAssignment,
  Technology,
  BuildingFilters,
} from "./types/context";
export type {
  ModuleComplexity,
  ModuleCategory,
  ModuleMeta,
  ModuleIO,
  ModuleProps,
  ModuleValidationResult,
  ModuleDefinition,
} from "./types/module";
export type {
  WorkflowStartType,
  WorkflowStep,
  WorkflowDefinition,
} from "./types/workflow";

// Context provider + hook
export {
  ModelBuilderContextProvider,
  ModelBuilderContext,
  type ModelBuilderAction,
  type ModelBuilderContextValue,
  type ModelBuilderContextProviderProps,
} from "./context/ModelBuilderContext";
export { useModelBuilderContext } from "./context/useModelBuilderContext";

// Workflow engine
export {
  WorkflowEngine,
  type WorkflowProgress,
  type WorkflowEngineOptions,
} from "./workflow/WorkflowEngine";

// Node-network engine (Phase 3)
export { NodeEngine, type NodeEngineOptions } from "./workflow/NodeEngine";

// Workflow registry
export {
  WorkflowRegistry,
  defaultWorkflowRegistry,
} from "./workflow/WorkflowRegistry";

// Workflow recommender
export {
  WorkflowRecommender,
  defaultWorkflowRecommender,
} from "./workflow/WorkflowRecommender";

// Workflow builder (admin UI)
export { WorkflowBuilder, type WorkflowBuilderProps } from "./workflow/WorkflowBuilder";

// Playback shell
export {
  ModelBuilderConfigurator,
  type ModelBuilderConfiguratorProps,
} from "./ModelBuilderConfigurator";

// Default workflow
export { defaultWorkflow } from "./workflows/defaultWorkflow";

// Feature flag
export { MODELBUILDER_ENABLED, MODELBUILDER_ROUTE } from "./flags";

// Module system (re-export the module barrel)
export * from "./modules";
