/**
 * Workflow runner + contract validation (Plan P2, README_V2 §3.1).
 *
 * A workflow is a linear sequence of modules. A node is runnable only when
 * its `requires` ⊆ accumulated `provides` of upstream nodes — checked against
 * both the definition (static) and the live context (runtime).
 */
import type { BackendAdapter } from "../adapter/types";
import type { ModelContext, SliceKey } from "../context/types";
import { getModule } from "./registry";
import type {
  ContractCheck,
  RunReport,
  ValidationResult,
  WorkflowDefinition,
} from "./types";

// ── static contract checks (used by the future admin builder, §3.1) ─────────

export function checkWorkflowContracts(def: WorkflowDefinition): ContractCheck[] {
  // context-load starts may hydrate any slice at runtime; gaps are handled by autofill.
  const accumulated = new Set<SliceKey>(
    def.start === "context-load"
      ? ["meta", "region", "grid", "demand", "techAssignments", "pypsa", "results", "userData"]
      : [],
  );
  const checks: ContractCheck[] = [];
  for (const node of def.nodes) {
    const mod = getModule(node.type);
    const missing = mod.requires.filter((r) => !accumulated.has(r));
    checks.push({ nodeId: node.id, satisfied: missing.length === 0, missing });
    mod.provides.forEach((p) => accumulated.add(p));
  }
  return checks;
}

export function isRunnable(def: WorkflowDefinition): boolean {
  return checkWorkflowContracts(def).every((c) => c.satisfied);
}

/** Which slices of the context actually hold meaningful data right now. */
export function availableSlices(ctx: ModelContext): Set<SliceKey> {
  const out = new Set<SliceKey>();
  if (ctx.meta.title.trim()) out.add("meta");
  if ((ctx.region.polygons?.features.length ?? 0) > 0 || ctx.region.boundary) out.add("region");
  if (ctx.grid.buildings.length > 0) out.add("grid");
  if (Object.keys(ctx.demand.entries).length > 0) out.add("demand");
  // techAssignments and pypsa are valid when empty (defaults) — always available.
  out.add("techAssignments");
  out.add("pypsa");
  if (ctx.results) out.add("results");
  if (ctx.userData.timeseries.length > 0 || ctx.userData.locationIds.length > 0) out.add("userData");
  return out;
}

// ── runtime execution ───────────────────────────────────────────────────────

export async function runNode(
  def: WorkflowDefinition,
  nodeId: string,
  ctx: ModelContext,
  api: BackendAdapter,
): Promise<{ ctx: ModelContext; report: RunReport }> {
  const nodeDef = def.nodes.find((n) => n.id === nodeId);
  if (!nodeDef) {
    return { ctx, report: { workflowId: def.id, nodeId, ok: false, error: "node not in workflow" } };
  }
  const mod = getModule(nodeDef.type);

  const missing = mod.requires.filter((r) => !availableSlices(ctx).has(r));
  if (missing.length > 0) {
    return {
      ctx,
      report: { workflowId: def.id, nodeId, ok: false, error: `missing context slices: ${missing.join(", ")}` },
    };
  }

  if (!mod.run) {
    return { ctx, report: { workflowId: def.id, nodeId, ok: true } };
  }
  try {
    const next = await mod.run(ctx, api, nodeDef.cfg);
    return { ctx: next, report: { workflowId: def.id, nodeId, ok: true } };
  } catch (err) {
    return {
      ctx,
      report: { workflowId: def.id, nodeId, ok: false, error: err instanceof Error ? err.message : String(err) },
    };
  }
}

export function validateNode(def: WorkflowDefinition, nodeId: string, ctx: ModelContext): ValidationResult {
  const nodeDef = def.nodes.find((n) => n.id === nodeId);
  if (!nodeDef) return { ok: false, issues: [{ path: "/", message: "node not in workflow" }] };
  return getModule(nodeDef.type).validate(ctx);
}

/** First node whose validate() fails — the step the user should be on. */
export function firstIncompleteNode(def: WorkflowDefinition, ctx: ModelContext): string | undefined {
  for (const node of def.nodes) {
    if (!getModule(node.type).validate(ctx).ok) return node.id;
  }
  return undefined;
}
