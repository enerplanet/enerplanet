import type { ComponentType } from "react";
import type {
  ModuleDefinition,
  ModuleIO,
  ModuleMeta,
  ModuleProps,
  ModuleValidationResult,
} from "../../types/module";
import type { ConfiguratorContext } from "../../types/context";

/**
 * Abstract template that every modular-workflow module extends.
 *
 * The base class enforces the data-contract pattern:
 *   - Declare what you read (`io.inputs`) and what you write (`io.outputs`)
 *   - Declare what must already exist (`io.required`)
 *   - Read input exclusively from the shared context
 *   - Write output back into the shared context
 *
 * Subclasses only need to provide:
 *   - `meta`  — identity & category
 *   - `io`    — input/output contract
 *   - `component` — the React UI
 *   - Optionally override `validate`, `onEnter`, `onLeave`
 */
export abstract class BaseModule {
  /** Module identity & category metadata */
  abstract readonly meta: ModuleMeta;

  /** Input/output contract against the shared context */
  abstract readonly io: ModuleIO;

  /** React component rendered in the configurator step */
  abstract readonly component: ComponentType<ModuleProps>;

  /** Sensible defaults used when the module is in basic mode */
  readonly defaults?: Record<string, unknown>;

  // ---------------------------------------------------------------------------
  // Context helpers
  // ---------------------------------------------------------------------------

  /**
   * Read the declared inputs from the shared context.
   * Returns a plain object keyed by the input names declared in `io.inputs`.
   */
  getInputs(context: ConfiguratorContext): Record<string, unknown> {
    const inputs: Record<string, unknown> = {};
    for (const key of this.io.inputs) {
      inputs[key] = (context as Record<string, unknown>)[key];
    }
    return inputs;
  }

  /**
   * Merge partial updates into the shared context.
   * Returns a new context object (immutable pattern).
   */
  writeOutputs(
    context: ConfiguratorContext,
    updates: Partial<ConfiguratorContext>,
  ): ConfiguratorContext {
    return { ...context, ...updates };
  }

  // ---------------------------------------------------------------------------
  // Validation
  // ---------------------------------------------------------------------------

  /**
   * Default validation: all `io.required` keys must be present in context.
   * Override in subclasses for custom validation logic.
   */
  validate(context: ConfiguratorContext): ModuleValidationResult {
    const missing = this.io.required.filter((key) => {
      const value = (context as Record<string, unknown>)[key];
      return value === undefined || value === null;
    });

    if (missing.length > 0) {
      return {
        valid: false,
        errors: missing.map((k) => `Missing required input: ${k}`),
      };
    }

    return { valid: true };
  }

  // ---------------------------------------------------------------------------
  // Lifecycle hooks
  // ---------------------------------------------------------------------------

  /** Called when entering this module — e.g. fetch data, initialise state. */
  onEnter?(context: ConfiguratorContext): Promise<void>;

  /** Called when leaving this module — e.g. validate, transform, persist. */
  onLeave?(context: ConfiguratorContext): Promise<ConfiguratorContext>;

  // ---------------------------------------------------------------------------
  // Module definition adapter
  // ---------------------------------------------------------------------------

  /**
   * Produce a plain `ModuleDefinition` object from this class instance.
   * This is what the inventory and workflow engine consume.
   */
  getDefinition(): ModuleDefinition {
    return {
      meta: this.meta,
      io: this.io,
      component: this.component,
      defaults: this.defaults,
      validate: (ctx) => this.validate(ctx),
      onEnter: this.onEnter?.bind(this),
      onLeave: this.onLeave?.bind(this),
    };
  }
}

// ---------------------------------------------------------------------------
// Factory helper — functional alternative to extending BaseModule
// ---------------------------------------------------------------------------

/**
 * Create a `ModuleDefinition` from a plain object.
 *
 * Use this when you prefer composition over inheritance. It fills in a
 * sensible default `validate` (checks required keys exist) so you only
 * need to provide a custom one if the logic is more complex.
 */
export function defineModule(
  def: Omit<ModuleDefinition, "validate"> & {
    validate?: ModuleDefinition["validate"];
  },
): ModuleDefinition {
  return {
    ...def,
    validate:
      def.validate ??
      ((ctx) => {
        const missing = def.io.required.filter(
          (k) => (ctx as Record<string, unknown>)[k] == null,
        );
        return missing.length > 0
          ? { valid: false, errors: missing.map((k) => `Missing required input: ${k}`) }
          : { valid: true };
      }),
  };
}

/**
 * Infer the context keys a module reads, writes, and requires.
 * Useful for tooling / workflow validation.
 */
export function getModuleContract(def: ModuleDefinition): ModuleIO {
  return def.io;
}

/**
 * Check whether a module can run given the current context.
 */
export function canRunModule(
  def: ModuleDefinition,
  context: ConfiguratorContext,
): ModuleValidationResult {
  return def.validate(context);
}
