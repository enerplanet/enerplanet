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
export {
  simulationSettingsModule,
  SimulationSettingsModule,
  getDefaultSimulationSettings,
  scenarioToDateRange,
  type SimulationSettings,
  type SimulationScenario,
  type ScenarioType,
} from "./simulation-settings/SimulationSettingsModule";
export { modelSaveModule, ModelSaveModule } from "./model-save";
export { modelLoadModule, ModelLoadModule } from "./model-load/ModelLoadModule";
export { buildingDemandModule, BuildingDemandModule } from "./building-demand";
export { transformerTopologyModule, TransformerTopologyModule } from "./transformer-topology";
export { areaEditModule, AreaEditModule } from "./area-edit/AreaEditModule";
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
import { simulationSettingsModule } from "./simulation-settings/SimulationSettingsModule";
import { modelSaveModule } from "./model-save";
import { modelLoadModule } from "./model-load/ModelLoadModule";
import { buildingDemandModule } from "./building-demand";
import { transformerTopologyModule } from "./transformer-topology";
import { areaEditModule } from "./area-edit/AreaEditModule";
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
  simulationSettingsModule,
  modelSaveModule,
  modelLoadModule,
  buildingDemandModule,
  transformerTopologyModule,
  areaEditModule,
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
