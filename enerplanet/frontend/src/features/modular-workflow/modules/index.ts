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

// Example modules
export { regionSelectModule, RegionSelectModule } from "./region-select/RegionSelectModule";
export { gridGenerationModule, GridGenerationModule } from "./grid-generation/GridGenerationModule";

// ---------------------------------------------------------------------------
// Pre-register example modules into the default inventory
// ---------------------------------------------------------------------------
import { defaultModuleInventory } from "./ModuleInventory";
import { regionSelectModule } from "./region-select/RegionSelectModule";
import { gridGenerationModule } from "./grid-generation/GridGenerationModule";

defaultModuleInventory.registerAll([regionSelectModule, gridGenerationModule]);

// Re-export the populated inventory as the default
export default defaultModuleInventory;
