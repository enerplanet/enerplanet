import type { WorkflowDefinition } from "../types/workflow";
import {
  ModuleInventory,
  defaultModuleInventory,
} from "../modules/ModuleInventory";
import { defaultWorkflows } from "../workflows";

/**
 * Registry of workflows, keyed by workflow ID.
 *
 * Loads, caches, and looks up workflows by ID. It is the single source of
 * truth for "what workflows exist" and is consumed by:
 *
 * - **Workflow Builder** — registers newly composed workflows
 * - **Workflow Recommender** — looks up follow-up workflows by ID
 * - **ModelBuilderPage** — lists all workflows to browse
 *
 * Importing a workflow JSON runs it through `ModuleInventory.validateWorkflow()`
 * so only structurally sound workflows are registered.
 */
export class WorkflowRegistry {
  private workflows = new Map<string, WorkflowDefinition>();
  private readonly inventory: ModuleInventory;

  constructor(inventory?: ModuleInventory) {
    this.inventory = inventory ?? defaultModuleInventory;
  }

  // ---------------------------------------------------------------------------
  // Registration
  // ---------------------------------------------------------------------------

  /** Register a single workflow. Returns `this` for chaining. */
  register(workflow: WorkflowDefinition): this {
    if (this.workflows.has(workflow.id)) {
      console.warn(
        `[WorkflowRegistry] Overwriting existing workflow: ${workflow.id}`,
      );
    }
    this.workflows.set(workflow.id, workflow);
    return this;
  }

  /** Register multiple workflows at once. */
  registerAll(workflows: WorkflowDefinition[]): this {
    for (const w of workflows) {
      this.register(w);
    }
    return this;
  }

  // ---------------------------------------------------------------------------
  // Accessors
  // ---------------------------------------------------------------------------

  /** Look up a workflow by ID. Returns `undefined` if not found. */
  get(id: string): WorkflowDefinition | undefined {
    return this.workflows.get(id);
  }

  /** Look up a workflow by ID or throw. */
  getOrThrow(id: string): WorkflowDefinition {
    const workflow = this.workflows.get(id);
    if (!workflow) {
      throw new Error(`[WorkflowRegistry] Workflow not registered: "${id}"`);
    }
    return workflow;
  }

  /** Return all registered workflows. */
  getAll(): WorkflowDefinition[] {
    return Array.from(this.workflows.values());
  }

  /** Return all registered workflow IDs. */
  getIds(): string[] {
    return Array.from(this.workflows.keys());
  }

  /** Remove a workflow by ID. Returns `true` if it was present. */
  remove(id: string): boolean {
    return this.workflows.delete(id);
  }

  // ---------------------------------------------------------------------------
  // Import / Export
  // ---------------------------------------------------------------------------

  /**
   * Parse and validate a workflow JSON string, then register it.
   *
   * Throws if the JSON is malformed, does not look like a workflow, or fails
   * `ModuleInventory.validateWorkflow()`.
   *
   * @returns the registered workflow definition.
   */
  importFromJson(json: string): WorkflowDefinition {
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch (err) {
      throw new Error(
        `[WorkflowRegistry] Invalid workflow JSON: ${err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    const workflow = this.coerceWorkflow(parsed);
    const validation = this.inventory.validateWorkflow(workflow);
    if (!validation.valid) {
      throw new Error(
        `[WorkflowRegistry] Workflow "${workflow.id}" failed validation: ${validation.errors.join("; ")}`,
      );
    }

    this.register(workflow);
    return workflow;
  }

  /** Serialize a workflow to a JSON string. */
  exportToJson(workflow: WorkflowDefinition): string {
    return JSON.stringify(workflow, null, 2);
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  /**
   * Best-effort coercion of an unknown parsed value into a `WorkflowDefinition`.
   * Performs a shallow structural check so we fail fast with a clear message
   * rather than silently registering a broken workflow.
   */
  private coerceWorkflow(value: unknown): WorkflowDefinition {
    if (typeof value !== "object" || value === null) {
      throw new Error("[WorkflowRegistry] Workflow must be an object");
    }
    const w = value as Record<string, unknown>;
    if (typeof w.id !== "string" || w.id.length === 0) {
      throw new Error("[WorkflowRegistry] Workflow is missing a string `id`");
    }
    if (typeof w.name !== "string") {
      throw new Error(`[WorkflowRegistry] Workflow "${w.id}" is missing a string \`name\``);
    }
    if (typeof w.description !== "string") {
      throw new Error(`[WorkflowRegistry] Workflow "${w.id}" is missing a string \`description\``);
    }
    if (typeof w.version !== "string") {
      throw new Error(`[WorkflowRegistry] Workflow "${w.id}" is missing a string \`version\``);
    }
    if (w.startType !== "from-scratch" && w.startType !== "from-existing-model") {
      throw new Error(
        `[WorkflowRegistry] Workflow "${w.id}" has an invalid \`startType\``,
      );
    }
    if (!Array.isArray(w.steps)) {
      throw new Error(`[WorkflowRegistry] Workflow "${w.id}" is missing a \`steps\` array`);
    }
    return value as WorkflowDefinition;
  }
}

// ---------------------------------------------------------------------------
// Singleton default instance
// ---------------------------------------------------------------------------

/**
 * The default workflow registry singleton, pre-loaded with the default
 * workflows from `workflows/index.ts`.
 */
export const defaultWorkflowRegistry = new WorkflowRegistry().registerAll(
  defaultWorkflows,
);
