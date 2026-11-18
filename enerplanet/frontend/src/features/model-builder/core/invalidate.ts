/**
 * The invalidator: *the cascade is the affected closure, minus what it cannot touch*.
 *
 * One pure function of `(primary, projection)`: given what a change wrote, which other ports does
 * this model no longer have a right to keep? Three rules, and nothing else:
 *
 * 1. **the `affect` closure** of the changed ports — transitive, because an edge is
 *    `input → the outputs that input affects`, and one edge's outputs are the next edge's inputs;
 * 2. **present** in the projection — an absent port has nothing to discard;
 * 3. **not written by the primary** — a change supersedes its own port, and pruning it would throw
 *    away the value the action is in the middle of writing.
 *
 * It never invents a prune outside the declared closure, and it never tries to predict what a
 * re-run would produce (impossible without running it — that finer minimality belongs at the
 * re-run boundary). The order of the closure is breadth-first from the changed ports, so a cascade
 * reads in the order things became affected.
 *
 * **Where it runs.** At seal, through the store's `deriveCascade` seam when a caller omits the
 * cascade; at redo, re-derived against the current projection. A caller that passes a cascade —
 * including `[]` — gets exactly what it passed, which is how a pure position move opts out.
 *
 * **Coarseness worth knowing:** the granularity is the *port*, not the nested path. A write under
 * `/buildingParams/gas` prunes the whole `buildingParams` port, so a module reading only
 * `electricity` is recomputed too. Correct, just not minimal — and `influence.ts`'s prober is
 * what keeps the *declarations* honest, which is the part that would be dangerous if wrong.
 */

import { portPath, type DiffOp } from "./diff";
import type { Flow, ModuleRegistry } from "./flow";
import type { ModelData, PortKey } from "./ports";

/** The store's invalidation seam: a primary diff plus the projection it will land on. */
export type Invalidator = (
  primary: readonly DiffOp[],
  data: Readonly<ModelData>,
) => DiffOp[];

/**
 * Build an invalidator from the flow it serves.
 *
 * The flow is needed because `affect` lives on the modules: the closure is their union, and only
 * the modules actually in this workflow can contribute an edge.
 */
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

/**
 * Every port reachable from `seeds` through the flow's `affect` maps, breadth-first.
 *
 * The seeds themselves are not included: they are what *changed*, so a cascade naming them would
 * be pruning the change rather than its consequences.
 */
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
