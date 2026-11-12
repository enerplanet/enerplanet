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
import { MissingRequiredPorts, PortWriteRejected } from "./errors";
import { requiredPorts, type Module, type ModuleCtx, type NodeRef } from "./module";
import type { ModelData, PortKey } from "./ports";
import type { Store } from "./store";

export interface Engine {
  /**
   * Run one module against the store as one workflow node.
   *
   * The transaction only exists *after* `run()` returns — unless the module declares
   * `seal: "per-commit"`, in which case each `commit()` seals its own atomic transaction.
   *
   * @param node the workflow node this run belongs to. `auto` is a node property, not a
   *             module one — the same module can be auto in one workflow and interactive in
   *             another — and it is stamped on the transaction so history can skip it (T14).
   * @returns the last sealed transaction, or `undefined` when the run changed nothing.
   * @throws {PortWriteRejected} when the module writes outside its declared surface, or
   * blind-overwrites a port it never read.
   */
  runModule(module: Module, node?: NodeRef): Promise<Transaction | undefined>;
}

export function createEngine(store: Store): Engine {
  return {
    async runModule(module, node) {
      // The store is the runtime truth (T21): the available-set the palette used may have been
      // optimistic, so never let a node run against a position the flow never satisfied.
      const missing = requiredPorts(module).filter((port) => store.data[port] === undefined);
      if (missing.length > 0) throw new MissingRequiredPorts(module.id, missing);

      const declared = new Set<PortKey>(module.params.map((param) => param.port));
      const consumed = new Set<PortKey>();
      let pending = new Map<PortKey, unknown>();
      let sealed: Transaction | undefined;

      /** Turn the buffered writes into one sealed transaction (nothing buffered → no transaction). */
      const flush = (): void => {
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
        pending = new Map();
        if (primary.length > 0) sealed = store.applyTransaction(primary, [], { node });
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

      // Default is one transaction for the whole run, so a module sees the pre-state for its
      // entire run and a rejection means nothing happened at all. `per-commit` opted out.
      if (module.seal !== "per-commit") flush();

      return sealed;
    },
  };
}
