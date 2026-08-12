/**
 * Workflow engine types (Plan P2, README_V2 Aspects 2/3, Aspect 7 module contract).
 *
 * Workflows are data (JSON). Nodes are modules: pure validators + async runners
 * over the context, with all I/O going through the BackendAdapter.
 */
import type { BackendAdapter } from "../adapter/types";
import type { ModelContext, SliceKey } from "../context/types";

// ── Validation ──────────────────────────────────────────────────────────────

export interface ValidationIssue {
  path: string; // context path, e.g. "/meta/title"
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
}

export const valid: ValidationResult = { ok: true, issues: [] };

export function invalid(...issues: ValidationIssue[]): ValidationResult {
  return { ok: false, issues };
}

// ── Node module contract ────────────────────────────────────────────────────

/**
 * A module reads from and writes to the context; it never owns data.
 * `run` performs the node's work (usually via the adapter) and returns the
 * next context. UI nodes validate only; execution happens through the shell.
 */
export interface NodeModule<Cfg = unknown> {
  id: string;
  /** Human label for step nav / admin lists. */
  label: string;
  requires: SliceKey[];
  provides: SliceKey[];
  /** Pure check: is the context ready to leave this node? */
  validate(ctx: ModelContext): ValidationResult;
  /** Optional async work (backend calls). Defaults to identity. */
  run?(ctx: ModelContext, api: BackendAdapter, cfg?: Cfg): Promise<ModelContext>;
}

// ── Workflow definition (JSON data) ─────────────────────────────────────────

export type WorkflowStart = "null" | "context-load";

export interface WorkflowNodeDef {
  id: string;
  /** Module id from the registry, e.g. "module:model-settings". */
  type: string;
  cfg?: unknown;
}

export interface WorkflowDefinition {
  id: string;
  version: number;
  name: string;
  start: WorkflowStart;
  /** Linear sequence for now; sub-loops are handled inside modules. */
  nodes: WorkflowNodeDef[];
}

// ── Engine results ──────────────────────────────────────────────────────────

export interface ContractCheck {
  nodeId: string;
  satisfied: boolean;
  missing: SliceKey[];
}

export interface RunReport {
  workflowId: string;
  nodeId: string;
  ok: boolean;
  issues?: ValidationIssue[];
  error?: string;
}
