/**
 * The engine — runs a module and seals what it wrote as one transaction.
 *
 * It builds the module context, enforces the write boundary (declared ports, anti-clobber), and
 * hands the collected writes to the store as a single sealed transaction.
 */

import { portPath, type DiffOp, type Transaction } from "./diff";
import { MissingRequiredPorts, PortWriteRejected } from "./errors";
import { requiredPorts, type Module, type ModuleCtx, type NodeRef } from "./module";
import type { ModelData, PortKey } from "./ports";
import type { Store } from "./store";

/** Whether a value carries nothing — an absent string, `null` or `undefined`; `[]`, `{}`, `0` and `false` are values. */
function carriesNothing(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  return typeof value === "string" && value.trim().length === 0;
}

export interface Engine {
  /**
   * Run one module against the store as one workflow node.
   *
   * @param node the workflow node this run belongs to; `auto` records whether it was an automatic step's.
   * @returns the last sealed transaction, or `undefined` when the run changed nothing.
   * @throws {PortWriteRejected} when the module writes outside its declared surface, or blind-overwrites a port it never read.
   */
  runModule(module: Module, node?: NodeRef): Promise<Transaction | undefined>;
}

export function createEngine(store: Store): Engine {
  return {
    async runModule(module, node) {
      // The store is the runtime truth: never run against a position the flow never satisfied.
      const missing = requiredPorts(module).filter((port) => store.data[port] === undefined);
      if (missing.length > 0) throw new MissingRequiredPorts(module.id, missing);

      const declared = new Set<PortKey>(module.params.map((param) => param.port));
      const consumed = new Set<PortKey>();
      let pending = new Map<PortKey, unknown>();
      let sealed: Transaction | undefined;

      /** Turn the buffered writes into one sealed transaction; a run always leaves a trace, even a no-op. */
      const flush = (): void => {
        // Nothing buffered and something already sealed: nothing to add.
        if (pending.size === 0 && sealed !== undefined) return;

        const primary: DiffOp[] = [];
        for (const [port, next] of pending) {
          const prev = store.data[port];
          if (Object.is(prev, next)) continue; // nothing changed — no op
          primary.push(
            next === undefined
              ? { op: "remove", path: portPath(port), prev }
              : { op: "replace", path: portPath(port), prev, next },
          );
        }
        pending = new Map();
        // No cascade passed: the store derives it from this change through the invalidator.
        sealed = store.applyTransaction(primary, undefined, { node });
      };

      const ctx: ModuleCtx = {
        get store(): Readonly<ModelData> {
          return store.data;
        },

        read<K extends PortKey>(port: K): ModelData[K] {
          consumed.add(port);
          return store.data[port];
        },

        commit(changes: Partial<ModelData>): void {
          for (const [port, next] of Object.entries(changes) as [PortKey, unknown][]) {
            if (!declared.has(port)) throw new PortWriteRejected(module.id, port, "undeclared");

            // A module must not finish with an output it has not filled; refused at the boundary.
            if (carriesNothing(next)) throw new PortWriteRejected(module.id, port, "empty");

            const current = store.data[port];
            if (current !== undefined && !consumed.has(port)) {
              throw new PortWriteRejected(module.id, port, "clobber");
            }

            pending.set(port, next);
          }

          if (module.seal === "per-commit") flush();
        },

        state: "active",
      };

      if (module.run) await module.run(ctx);

      // Every run ends with a flush, `per-commit` included — a no-op run still seals its zero-diff trace here.
      flush();

      return sealed;
    },
  };
}
