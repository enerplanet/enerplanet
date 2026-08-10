// ---------------------------------------------------------------------------
// Modular Workflow — module system barrel export
// ---------------------------------------------------------------------------
//
// Usage:
//   import { defaultModuleInventory, BaseModule, defineModule } from "./modules";
//   import { regionSelectModule } from "./modules/region-select";
//
//   defaultModuleInventory.register(regionSelectModule);
// ---------------------------------------------------------------------------

// Base template
export { BaseModule, defineModule, getModuleContract, canRunModule } from "./base/BaseModule";
export type { BaseModule as BaseModuleType } from "./base/BaseModule";

// Inventory
export { ModuleInventory, defaultModuleInventory } from "./ModuleInventory";

// Modules
export { regionSelectModule, RegionSelectModule } from "./region-select/RegionSelectModule";
export { gridGenerationModule, GridGenerationModule } from "./grid-generation/GridGenerationModule";
export { advancedParamsModule, AdvancedParamsModule } from "./advanced-params";
export { modelSaveModule, ModelSaveModule } from "./model-save";
export { buildingDemandModule, BuildingDemandModule } from "./building-demand";
export { transformerTopologyModule, TransformerTopologyModule } from "./transformer-topology";
export { technologySelectionModule, TechnologySelectionModule } from "./technology-selection";
export { powerFlowModule, PowerFlowModule } from "./power-flow";
export { gridStatisticsModule, GridStatisticsModule } from "./grid-statistics";
export { costBreakdownModule, CostBreakdownModule } from "./cost-breakdown";
export { hostingCapacityModule, HostingCapacityModule } from "./hosting-capacity";
export { pipelineModule, PipelineModule } from "./pipeline";
export { modelDiffModule, ModelDiffModule, ModelDiffViewer } from "./model-diff";

// ---------------------------------------------------------------------------
// Pre-register all modules into the default inventory
// ---------------------------------------------------------------------------
import { defaultModuleInventory } from "./ModuleInventory";
import { regionSelectModule } from "./region-select/RegionSelectModule";
import { gridGenerationModule } from "./grid-generation/GridGenerationModule";
import { advancedParamsModule } from "./advanced-params";
import { modelSaveModule } from "./model-save";
import { buildingDemandModule } from "./building-demand";
import { transformerTopologyModule } from "./transformer-topology";
import { technologySelectionModule } from "./technology-selection";
import { powerFlowModule } from "./power-flow";
import { gridStatisticsModule } from "./grid-statistics";
import { costBreakdownModule } from "./cost-breakdown";
import { hostingCapacityModule } from "./hosting-capacity";
import { pipelineModule } from "./pipeline";
import { modelDiffModule } from "./model-diff";

defaultModuleInventory.registerAll([
  regionSelectModule,
  gridGenerationModule,
  advancedParamsModule,
  modelSaveModule,
  buildingDemandModule,
  transformerTopologyModule,
  technologySelectionModule,
  powerFlowModule,
  gridStatisticsModule,
  costBreakdownModule,
  hostingCapacityModule,
  pipelineModule,
  modelDiffModule,
]);

// Re-export the populated inventory as the default
export default defaultModuleInventory;
