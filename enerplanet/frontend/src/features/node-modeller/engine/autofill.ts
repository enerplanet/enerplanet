/**
 * Dependency auto-fill (Plan P2, README_V2 §3.4).
 *
 * Given a context-load start and a workflow whose downstream nodes require
 * slices the loaded context lacks, insert the minimal chain of modules that
 * produce them. Deterministic because contracts are explicit.
 */
import type { ModelContext, SliceKey } from "../context/types";
import { getModule, listModules } from "./registry";
import { availableSlices } from "./runner";
import type { WorkflowDefinition, WorkflowNodeDef } from "./types";

/**
 * Returns a new definition with producing nodes inserted before the first
 * consumer of each missing slice. Slices no registered module can provide
 * are skipped (caller must handle).
 */
export function autofillDependencies(def: WorkflowDefinition, ctx: ModelContext): WorkflowDefinition {
  const have = availableSlices(ctx);
  const nodes: WorkflowNodeDef[] = [...def.nodes];
  const inserted = new Set<string>();

  // Iterate until stable — a producer may itself require a missing slice.
  let changed = true;
  let guard = 0;
  while (changed && guard++ < 10) {
    changed = false;
    // Accumulated provides across the sequence, starting from loaded slices.
    const accumulated = new Set<SliceKey>(have);
    for (let i = 0; i < nodes.length; i++) {
      const mod = getModule(nodes[i].type);
      for (const req of mod.requires) {
        if (accumulated.has(req)) continue;
        const producer = listModules().find(
          (m) => m.provides.includes(req) && !inserted.has(m.id) && m.id !== mod.id,
        );
        if (!producer) continue;
        nodes.splice(i, 0, { id: `${producer.id}-autofill`, type: producer.id });
        inserted.add(producer.id);
        producer.provides.forEach((p) => accumulated.add(p));
        changed = true;
        break;
      }
      if (changed) break;
      mod.provides.forEach((p) => accumulated.add(p));
    }
  }
  return { ...def, nodes };
}
