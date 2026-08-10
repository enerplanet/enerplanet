import type { BaseModule } from "./base/BaseModule";
import type { ModuleDefinition } from "../types/module";
import type { WorkflowDefinition } from "../types/workflow";

/**
 * Registry of all available modular-workflow modules.
 *
 * The inventory is the single source of truth for "what modules exist" and
 * "what each module needs / produces". It is consumed by:
 *
 * - **Workflow Builder** — lists available modules, shows their I/O contracts
 * - **Workflow Engine** — resolves step moduleIds to ModuleDefinitions
 * - **Validation** — checks that a workflow's data dependencies are satisfied
 */
export class ModuleInventory {
  private modules = new Map<string, BaseModule>();

  // ---------------------------------------------------------------------------
  // Registration
  // ---------------------------------------------------------------------------

  /** Register a single module. Returns `this` for chaining. */
  register(module: BaseModule): this {
    if (this.modules.has(module.meta.id)) {
      console.warn(
        `[ModuleInventory] Overwriting existing module: ${module.meta.id}`,
      );
    }
    this.modules.set(module.meta.id, module);
    return this;
  }

  /** Register multiple modules at once. */
  registerAll(modules: BaseModule[]): this {
    for (const m of modules) {
      this.register(m);
    }
    return this;
  }

  // ---------------------------------------------------------------------------
  // Accessors
  // ---------------------------------------------------------------------------

  /** Look up a module by ID. Returns `undefined` if not found. */
  getModule(id: string): BaseModule | undefined {
    return this.modules.get(id);
  }

  /** Look up a module by ID or throw. */
  getModuleOrThrow(id: string): BaseModule {
    const module = this.modules.get(id);
    if (!module) {
      throw new Error(`[ModuleInventory] Module not registered: "${id}"`);
    }
    return module;
  }

  /** Return all registered modules. */
  getAllModules(): BaseModule[] {
    return Array.from(this.modules.values());
  }

  /** Return all registered module IDs. */
  getModuleIds(): string[] {
    return Array.from(this.modules.keys());
  }

  /** Return all registered module definitions (for the workflow engine). */
  getAllDefinitions(): ModuleDefinition[] {
    return this.getAllModules().map((m) => m.getDefinition());
  }

  // ---------------------------------------------------------------------------
  // Workflow-requirement functions
  // ---------------------------------------------------------------------------

  /**
   * Resolve the module definitions required by a workflow's steps.
   *
   * Skips steps whose `moduleId` is not registered (logs a warning).
   * The returned array is in the same order as `workflow.steps`.
   */
  getWorkflowRequiredDefinitions(
    workflow: WorkflowDefinition,
  ): ModuleDefinition[] {
    const defs: ModuleDefinition[] = [];

    for (const step of workflow.steps) {
      const module = this.getModule(step.moduleId);
      if (!module) {
        console.warn(
          `[ModuleInventory] Workflow "${workflow.id}" references unknown module: "${step.moduleId}"`,
        );
        continue;
      }
      defs.push(module.getDefinition());
    }

    return defs;
  }

  /**
   * Aggregate all context keys a workflow needs as input across all its steps.
   * This is the union of every step's `io.inputs`.
   */
  getWorkflowInputs(workflow: WorkflowDefinition): string[] {
    const inputs = new Set<string>();

    for (const step of workflow.steps) {
      const module = this.getModule(step.moduleId);
      if (!module) continue;
      for (const key of module.io.inputs) {
        inputs.add(key);
      }
    }

    return Array.from(inputs);
  }

  /**
   * Aggregate all context keys a workflow produces across all its steps.
   * This is the union of every step's `io.outputs`.
   */
  getWorkflowOutputs(workflow: WorkflowDefinition): string[] {
    const outputs = new Set<string>();

    for (const step of workflow.steps) {
      const module = this.getModule(step.moduleId);
      if (!module) continue;
      for (const key of module.io.outputs) {
        outputs.add(key);
      }
    }

    return Array.from(outputs);
  }

  /**
   * Validate that every step's required inputs are satisfied by either:
   *   - a pre-seeded context key (passed via `seed`)
   *   - an output from an earlier step in the workflow
   *
   * Also checks that every `moduleId` in the workflow is registered.
   */
  validateWorkflow(
    workflow: WorkflowDefinition,
    seed?: string[],
  ): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    const available = new Set<string>(seed ?? []);

    for (const step of workflow.steps) {
      const module = this.getModule(step.moduleId);

      if (!module) {
        errors.push(
          `Step "${step.label}" references unknown module: "${step.moduleId}"`,
        );
        continue;
      }

      // Check required inputs
      for (const req of module.io.required) {
        if (!available.has(req)) {
          errors.push(
            `Step "${step.label}" requires "${req}" but it is not produced by an earlier step or seeded`,
          );
        }
      }

      // Register outputs for downstream steps
      for (const out of module.io.outputs) {
        available.add(out);
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Return a human-readable summary of all registered modules and their contracts.
   * Useful for debugging, logging, or rendering a module picker.
   */
  getCatalogSummary(): Array<{
    id: string;
    name: string;
    category: string;
    complexity: string;
    inputs: string[];
    outputs: string[];
    required: string[];
  }> {
    return this.getAllModules().map((m) => ({
      id: m.meta.id,
      name: m.meta.name,
      category: m.meta.category,
      complexity: m.meta.defaultComplexity,
      inputs: m.io.inputs,
      outputs: m.io.outputs,
      required: m.io.required,
    }));
  }
}

// ---------------------------------------------------------------------------
// Singleton default instance
// ---------------------------------------------------------------------------

/**
 * The default module inventory singleton.
 *
 * Import this in the app bootstrap and call `registerAll()` with your modules.
 * Example:
 *
 * ```ts
 * import { defaultModuleInventory } from "./modules/ModuleInventory";
 * import { regionSelectModule } from "./modules/region-select";
 *
 * defaultModuleInventory.register(regionSelectModule);
 * ```
 */
export const defaultModuleInventory = new ModuleInventory();
