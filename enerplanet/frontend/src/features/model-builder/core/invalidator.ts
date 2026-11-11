/**
 * The invalidator (`Plan.md` §5) — turns a change into the **stale ports** it leaves behind.
 *
 * A pure function of the change, the projection and the modules currently in the flow:
 * each module's `affect` map supplies the static potential edges, and three rules make the
 * result minimal —
 *
 * 1. **affected closure** — transitively reachable over the declared edges,
 * 2. **present** — a port that isn't in the store has nothing to prune,
 * 3. **not superseded** — a port the change itself writes is already the newest value.
 *
 * What it deliberately does *not* do is predict what a re-run would compute: that is
 * unknowable without running it. The finer minimality is bought at the re-run boundary,
 * where a node that re-derives an identical value seals no transaction (T20's elision).
 *
 * The cascade is expressed as ports, never as nodes — mapping stale ports back onto the flow
 * is the flow layer's job, which keeps history and invalidation free of workflow knowledge.
 */

import { portPath, type DiffOp } from "./diff";
import type { Module } from "./module";
import type { ModelData, PortKey } from "./ports";

export interface CascadeInput {
  /** Ports the action actually changed. */
  changed: readonly PortKey[];
  /** The action's own diff — a port it writes is never also pruned. */
  primary: readonly DiffOp[];
  /** The projection the cascade will be applied to. */
  data: Readonly<ModelData>;
  /**
   * The modules currently in the flow. Only their `affect` maps matter here; a module whose
   * `params` don't include a changed port declares no edge from it.
   */
  modules: readonly Module[];
}

/** The top-level ports a diff touches, in first-seen order (nested paths fold to their port). */
export function changedPorts(primary: readonly DiffOp[]): PortKey[] {
  const ports: PortKey[] = [];
  for (const op of primary) {
    const port = topLevelPort(op.path);
    if (port !== undefined && !ports.includes(port)) ports.push(port);
  }
  return ports;
}

function topLevelPort(path: string): PortKey | undefined {
  const [head] = path.split("/").filter((segment) => segment.length > 0);
  return head === undefined ? undefined : (head as PortKey);
}

/**
 * Stage the candidate cascade for a change.
 *
 * @returns prune ops, in declared `affect` order — the caller seals them into the same
 *          transaction as the change that caused them (`Plan.md` §6).
 */
export function stageCascade({ changed, primary, data, modules }: CascadeInput): DiffOp[] {
  const superseded = new Set<PortKey>(changedPorts(primary));
  const seen = new Set<PortKey>();
  const stale: PortKey[] = [];
  const queue: PortKey[] = [...changed];

  // Breadth-first over the declared edges. No cycle guard is needed: `seen` already bounds
  // the walk, and the flow itself is acyclic.
  while (queue.length > 0) {
    const port = queue.shift() as PortKey;

    for (const module of modules) {
      if (!module.params.some((param) => param.port === port)) continue;

      for (const output of module.affect[port] ?? []) {
        if (seen.has(output)) continue;
        seen.add(output);
        stale.push(output);
        queue.push(output);
      }
    }
  }

  return stale
    .filter((port) => !superseded.has(port) && data[port] !== undefined)
    .map((port) => ({ op: "remove" as const, path: portPath(port), prev: data[port] }));
}
