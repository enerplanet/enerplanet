/**
 * The invalidator: the cascade is the affected closure, minus what it cannot touch.
 *
 * One pure function of `(primary, projection)`: the ports the change leaves stale — the `affect`
 * closure of the changed ports, present in the projection, minus the ports the change itself wrote.
 */

import { portPath, type DiffOp } from "./diff";
import type { Flow, ModuleRegistry } from "./flow";
import type { ModelData, PortKey } from "./ports";

/** The store's invalidation seam: a primary diff plus the projection it will land on. */
export type Invalidator = (
  primary: readonly DiffOp[],
  data: Readonly<ModelData>,
) => DiffOp[];

/** Build an invalidator from the flow it serves; `affect` lives on the modules. */
export function createInvalidator(flow: Flow, registry: ModuleRegistry): Invalidator {
  return (primary, data) => {
    const changed = writtenPorts(primary);
    const superseded = new Set<PortKey>(changed);
    const affected = closureOf(changed, flow, registry);

    return affected
      .filter((port) => !superseded.has(port) && data[port] !== undefined)
      .map((port) => ({ op: "remove" as const, path: portPath(port), prev: data[port] }));
  };
}

/** The top-level ports a diff touches, in order, without repeats. */
function writtenPorts(ops: readonly DiffOp[]): PortKey[] {
  const ports: PortKey[] = [];

  for (const op of ops) {
    const [port] = op.path.split("/").filter(Boolean);
    if (port !== undefined && !ports.includes(port as PortKey)) ports.push(port as PortKey);
  }

  return ports;
}

/** Every port reachable from `seeds` through the flow's `affect` maps, breadth-first; the seeds themselves are excluded. */
function closureOf(
  seeds: readonly PortKey[],
  flow: Flow,
  registry: ModuleRegistry,
): PortKey[] {
  const reached: PortKey[] = [];
  const frontier = [...seeds];

  while (frontier.length > 0) {
    const port = frontier.shift() as PortKey;

    for (const node of flow) {
      const module = registry[node.moduleId];
      if (module === undefined) continue;

      // `affect` is keyed by the input, valued by the outputs it can invalidate.
      for (const output of module.affect[port] ?? []) {
        if (reached.includes(output) || frontier.includes(output)) continue;
        reached.push(output);
        frontier.push(output);
      }
    }
  }

  return reached;
}
