/**
 * The engine — runs a module and seals what it wrote as one transaction (`Plan.md` §6).
 *
 * Responsibilities kept deliberately narrow for now: build the module context, enforce
 * the write boundary (declared ports, anti-clobber), and hand the collected writes to the
 * store as a single sealed transaction. Gating, invalidation and history come next.
 *
 * The transaction only exists *after* `run()` returns, which is what makes an action
 * atomic: a module sees the pre-state for the whole run, and any rejection means nothing
 * happened at all.
 */

import { portPath, type DiffOp, type Transaction } from "./diff";
import { PortWriteRejected } from "./errors";
import type { Module, ModuleCtx } from "./module";
import type { ModelData, PortKey } from "./ports";
import type { Store } from "./store";

export interface Engine {
  /**
   * Run one module against the store.
   *
   * @returns the sealed transaction, or `undefined` when the run changed nothing.
   * @throws {PortWriteRejected} when the module writes outside its declared surface, or
   * blind-overwrites a port it never read.
   */
  runModule(module: Module, nodeId?: string): Promise<Transaction | undefined>;
}

export function createEngine(store: Store): Engine {
  return {
    async runModule(module, nodeId) {
      const declared = new Set<PortKey>(module.params.map((param) => param.port));
      const consumed = new Set<PortKey>();
      const pending = new Map<PortKey, unknown>();

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

            const current = store.data[port];
            if (current !== undefined && !consumed.has(port)) {
              throw new PortWriteRejected(module.id, port, "clobber");
            }

            pending.set(port, next);
          }
        },

        state: "active",
      };

      if (module.run) await module.run(ctx);

      const primary: DiffOp[] = [];
      for (const [port, next] of pending) {
        const prev = store.data[port];
        if (Object.is(prev, next)) continue; // nothing changed — no op, no transaction
        primary.push(
          next === undefined
            ? { op: "remove", path: portPath(port), prev }
            : { op: "replace", path: portPath(port), prev, next },
        );
      }

      if (primary.length === 0) return undefined;

      return store.applyTransaction(primary, [], nodeId);
    },
  };
}
