import type { ComponentType } from "react";
import type { ConfiguratorContext } from "./context";

export type ModuleComplexity = "basic" | "expert";

export type ModuleCategory =
  | "input"
  | "simulation"
  | "analysis"
  | "optimization"
  | "output";

export interface ModuleMeta {
  id: string;
  name: string;
  description: string;
  icon?: string;
  category: ModuleCategory;
  /** Default complexity level for this module */
  defaultComplexity: ModuleComplexity;
}

/**
 * Input/output contract of a module against the shared context.
 *
 * - `inputs`  — context keys this module reads
 * - `outputs` — context keys this module writes
 * - `required`— context keys that must exist before this module can run
 */
export interface ModuleIO {
  inputs: string[];
  outputs: string[];
  required: string[];
}

export interface ModuleProps {
  context: ConfiguratorContext;
  onUpdate: (updates: Partial<ConfiguratorContext>) => void;
  /** Current UI complexity mode — module renders differently based on this */
  complexity: ModuleComplexity;
  /** Toggle handler — module can request a mode switch if needed */
  onComplexityChange: (mode: ModuleComplexity) => void;
}

export interface ModuleValidationResult {
  valid: boolean;
  errors?: string[];
}

export interface ModuleDefinition {
  meta: ModuleMeta;
  io: ModuleIO;
  /** React component rendered in the configurator step */
  component: ComponentType<ModuleProps>;
  /** Sensible defaults used when module is in basic mode */
  defaults?: Record<string, unknown>;
  /** Validation function — returns true if module has sufficient data */
  validate: (context: ConfiguratorContext) => ModuleValidationResult;
  /** Optional — called when entering this module */
  onEnter?: (context: ConfiguratorContext) => Promise<void>;
  /** Optional — called when leaving this module */
  onLeave?: (context: ConfiguratorContext) => Promise<ConfiguratorContext>;
}
