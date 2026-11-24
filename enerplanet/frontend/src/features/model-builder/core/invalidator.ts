/**
 * The invalidator — turns a change into the stale ports it leaves behind.
 *
 * A pure function of the change, the projection and the modules in the flow: the affected closure,
 * present in the store, minus what the change itself wrote. Expressed as ports, never as nodes.
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
  /** The modules currently in the flow; only their `affect` maps matter here. */
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
 *          transaction as the change that caused them.
 */
export function stageCascade({ changed, primary, data, modules }: CascadeInput): DiffOp[] {
  const superseded = new Set<PortKey>(changedPorts(primary));
  const seen = new Set<PortKey>();
  const stale: PortKey[] = [];
  const queue: PortKey[] = [...changed];

  // Breadth-first over the declared edges; `seen` bounds the walk.
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
