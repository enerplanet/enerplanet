/**
 * The engine — runs a module and seals what it wrote as one transaction.
 *
 * Responsibilities kept deliberately narrow: build the module context, enforce
 * the write boundary (declared ports, anti-clobber), and hand the collected writes to the
 * store as a single sealed transaction — **omitting the cascade**, so the store's invalidator
 * derives what the change affects. Gating already happens here; history lives in the store.
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

/**
 * Does this value carry nothing?
 *
 * Deliberately strict about *absences* and deliberately silent about *collections*: an empty string, `null`
 * and `undefined` are a module declining to say anything, while `[]`, `{}` and a GeoJSON collection with no
 * features are things a module may legitimately have to say — and only the module's own `validate()` can
 * judge whether such a result is finished. `0` and `false` are values too, so they are never empty.
 */
function carriesNothing(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  return typeof value === "string" && value.trim().length === 0;
}

export interface Engine {
  /**
   * Run one module against the store as one workflow node.
   *
   * The transaction only exists *after* `run()` returns — unless the module declares
   * `seal: "per-commit"`, in which case each `commit()` seals its own atomic transaction.
   *
   * @param node the workflow node this run belongs to. `auto` records whether the run was an automatic
   *             step's — sourced from the module's own `auto` flag (`Module.auto`) — and is stamped on the
   *             transaction so history can skip it.
   * @returns the last sealed transaction, or `undefined` when the run changed nothing.
   * @throws {PortWriteRejected} when the module writes outside its declared surface, or
   * blind-overwrites a port it never read.
   */
  runModule(module: Module, node?: NodeRef): Promise<Transaction | undefined>;
}

export function createEngine(store: Store): Engine {
  return {
    async runModule(module, node) {
      // The store is the runtime truth: the available-set the palette used may have been
      // optimistic, so never let a node run against a position the flow never satisfied.
      const missing = requiredPorts(module).filter((port) => store.data[port] === undefined);
      if (missing.length > 0) throw new MissingRequiredPorts(module.id, missing);

      const declared = new Set<PortKey>(module.params.map((param) => param.port));
      const consumed = new Set<PortKey>();
      let pending = new Map<PortKey, unknown>();
      let sealed: Transaction | undefined;

      /**
       * Turn the buffered writes into one sealed transaction.
       *
       * **A run always leaves a trace** — one transaction, even when nothing changed. It has to: a jump re-arms
       * its target and the re-arm clears on a *newer transaction*, so a node the user jumped back to
       * would otherwise read `stale` forever unless they invented an edit. Going back to look at something is
       * not an edit, and pressing the forward action has to be enough to leave.
       *
       * The writes still become ops only when they differ (above), so a no-op run carries an empty primary —
       * the same zero-diff transaction a jump with an empty cascade seals, and for the same reason: the move is
       * the fact worth recording, not the diff.
       */
      const flush = (): void => {
        // Nothing buffered and something already sealed: this flush has nothing to add. A `per-commit` module
        // that committed at least once has already left its trace, and a second empty one would be noise.
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
        // No cascade passed: the store derives it from this change through the invalidator,
        // so the transaction's prunes are the change's real consequences.
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

            // A module must not finish with an output it has not filled. Refused here, at the
            // boundary, so a module cannot store a hollow value and then claim `validate()` is satisfied.
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

      // Every run ends with a flush, `per-commit` included — see `flush`. A module that committed nothing, or a
      // `per-commit` one whose writes were all no-ops, still seals its zero-diff trace here; without it a jump
      // back to the node would have no way to clear its re-arm.
      flush();

      return sealed;
    },
  };
}
