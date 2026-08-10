import type { ModuleDefinition } from "../types/module";
import type { ConfiguratorContext } from "../types/context";
import type { WorkflowDefinition } from "../types/workflow";
import {
  ModuleInventory,
  defaultModuleInventory,
} from "../modules/ModuleInventory";

export interface WorkflowProgress {
  current: number;
  total: number;
  percent: number;
}

export interface WorkflowEngineOptions {
  /** Module registry used to resolve step moduleIds to definitions. */
  inventory?: ModuleInventory;
  /** Called whenever the internal context changes (e.g. to sync with React). */
  onContextChange?: (context: ConfiguratorContext) => void;
}

/**
 * Core playback controller for a workflow.
 *
 * Owns the workflow definition, the current step index, and a working copy of
 * the shared context. It resolves each step's `moduleId` to a
 * `ModuleDefinition` via the `ModuleInventory`, validates `io.required` keys
 * before advancing, calls lifecycle hooks (`onLeave` / `onEnter`), and merges
 * module output back into the context.
 *
 * The engine is framework-agnostic. The React playback shell
 * (`ModelBuilderConfigurator`) drives it and syncs the resulting context back
 * into the `ModelBuilderContextProvider` via `onContextChange`.
 */
export class WorkflowEngine {
  private readonly workflow: WorkflowDefinition;
  private readonly inventory: ModuleInventory;
  private readonly onContextChange?: (context: ConfiguratorContext) => void;
  private context: ConfiguratorContext;
  private currentStepIndex: number;

  constructor(
    workflow: WorkflowDefinition,
    initialContext?: ConfiguratorContext,
    options?: WorkflowEngineOptions,
  ) {
    this.workflow = workflow;
    this.inventory = options?.inventory ?? defaultModuleInventory;
    this.onContextChange = options?.onContextChange;
    this.context = initialContext ?? {};
    this.currentStepIndex = 0;
  }

  // ---------------------------------------------------------------------------
  // Accessors
  // ---------------------------------------------------------------------------

  /** Returns the current step's module definition. */
  getCurrentModule(): ModuleDefinition {
    const step = this.workflow.steps[this.currentStepIndex];
    if (!step) {
      throw new Error(
        `[WorkflowEngine] No step at index ${this.currentStepIndex} in workflow "${this.workflow.id}"`,
      );
    }
    return this.inventory.getModuleOrThrow(step.moduleId).getDefinition();
  }

  /** Returns the current step definition (label, auto, skippable, ...). */
  getCurrentStep() {
    return this.workflow.steps[this.currentStepIndex];
  }

  /** Returns the workflow definition. */
  getWorkflow(): WorkflowDefinition {
    return this.workflow;
  }

  /** Returns the current step index. */
  getCurrentIndex(): number {
    return this.currentStepIndex;
  }

  /** Returns progress info. */
  getProgress(): WorkflowProgress {
    const total = this.workflow.steps.length;
    const current = Math.min(this.currentStepIndex + 1, total);
    return {
      current,
      total,
      percent: total === 0 ? 0 : Math.round((current / total) * 100),
    };
  }

  /** Returns the full context (for save/export). */
  getContext(): ConfiguratorContext {
    return this.context;
  }

  /**
   * Merge partial updates into the engine's working context. Modules write via
   * `onUpdate` in the React shell; the shell forwards those updates here so the
   * engine sees the latest module output before `next()` validates/merges.
   */
  updateContext(updates: Partial<ConfiguratorContext>): void {
    this.context = { ...this.context, ...updates };
  }

  /** Returns recommended follow-up workflows based on the current context. */
  getRecommendations(): WorkflowDefinition[] {
    const followUpIds = this.workflow.followUpWorkflows ?? [];
    // Phase 1 has no WorkflowRegistry yet, so we can only surface the IDs.
    // The shell can resolve these against a registry later.
    return followUpIds.map((id) => ({ id } as WorkflowDefinition));
  }

  /** True when the current step is the last one. */
  isLastStep(): boolean {
    return this.currentStepIndex >= this.workflow.steps.length - 1;
  }

  /** True when the workflow has been fully traversed. */
  isComplete(): boolean {
    return this.currentStepIndex >= this.workflow.steps.length;
  }

  // ---------------------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------------------

  /**
   * Navigate to the next step.
   *
   * 1. Calls the current module's `onLeave` (may transform/validate output).
   * 2. Validates that all `io.required` keys exist in context — blocks if missing.
   * 3. Merges the module's output into the context.
   * 4. Advances the index and calls the next module's `onEnter`.
   * 5. Runs `auto: true` steps automatically.
   */
  async next(): Promise<void> {
    if (this.isComplete()) {
      throw new Error("[WorkflowEngine] Workflow already complete");
    }

    const currentModule = this.getCurrentModule();
    const currentStep = this.getCurrentStep();

    // 1. onLeave — may validate/transform and return an updated context.
    if (currentModule.onLeave) {
      const left = await currentModule.onLeave(this.context);
      if (left) this.context = left;
    }

    // 2. Validate required keys before advancing.
    const validation = currentModule.validate(this.context);
    if (!validation.valid) {
      throw new Error(
        `[WorkflowEngine] Cannot advance past step "${currentStep.label}": ${validation.errors?.join("; ") ?? "validation failed"
        }`,
      );
    }

    // 3. Merge the module's declared outputs into the context.
    this.mergeOutputs(currentModule);

    // 4. Advance.
    this.currentStepIndex += 1;

    // 5. Run auto steps automatically.
    await this.runAutoSteps();

    this.notifyContextChange();
  }

  /** Navigate to the previous step. */
  async previous(): Promise<void> {
    if (this.currentStepIndex <= 0) {
      throw new Error("[WorkflowEngine] Already at the first step");
    }
    this.currentStepIndex -= 1;
    const module = this.getCurrentModule();
    if (module.onEnter) {
      await module.onEnter(this.context);
    }
    this.notifyContextChange();
  }

  /** Jump to a specific step index. */
  async goTo(index: number): Promise<void> {
    if (index < 0 || index >= this.workflow.steps.length) {
      throw new Error(
        `[WorkflowEngine] Step index ${index} out of range (0..${this.workflow.steps.length - 1})`,
      );
    }
    this.currentStepIndex = index;
    const module = this.getCurrentModule();
    if (module.onEnter) {
      await module.onEnter(this.context);
    }
    this.notifyContextChange();
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  /**
   * Merge a module's declared `io.outputs` from the current context into the
   * engine's working context. Outputs are read from the context because
   * modules write via `onUpdate` (which the shell syncs back into the engine).
   */
  private mergeOutputs(module: ModuleDefinition): void {
    const merged: ConfiguratorContext = { ...this.context };
    for (const key of module.io.outputs) {
      const value = (this.context as Record<string, unknown>)[key];
      if (value !== undefined) {
        (merged as Record<string, unknown>)[key] = value;
      }
    }
    this.context = merged;
  }

  /**
   * Advance through any consecutive `auto: true` steps, calling their
   * `onEnter` hooks (which typically trigger the underlying service call).
   */
  private async runAutoSteps(): Promise<void> {
    while (
      !this.isComplete() &&
      this.getCurrentStep()?.auto === true
    ) {
      const module = this.getCurrentModule();
      if (module.onEnter) {
        await module.onEnter(this.context);
      }
      this.currentStepIndex += 1;
    }
  }

  private notifyContextChange(): void {
    this.onContextChange?.(this.context);
  }
}
