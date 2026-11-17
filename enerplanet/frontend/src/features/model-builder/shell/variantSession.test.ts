/**
 * The shell's half of `model-variant`'s switch (`shell/variantSession.ts`) — the fork's own session row, and the
 * guard that keeps it to one write.
 *
 * Two things are pinned, and they are the two the change rests on:
 *
 * - **the row is self-consistent** — keyed by the variant's model id, its log including the switch transaction,
 *   its projection the store after the switch, its fingerprint recomputed over that projection, so
 *   `fromArtefact` trusts it rather than replaying the switch away (`core/artefact.ts:125-136`);
 * - **it is written once per fork** — a session that arrived with a variant already recorded (a load, a reset)
 *   owes nothing, and a fork is claimed exactly once, so a re-render or a later store change is not a second
 *   write.
 *
 * Written failing first.
 */
import { describe, expect, it } from "vitest";
import { fromArtefact, type Artefact, type WorkflowRef } from "../core/artefact";
import { portPath, type DiffOp } from "../core/diff";
import { createStore, type Store } from "../core/store";
import type { ModelGateway } from "../save/gateway";
import {
  createVariantSessionGuard,
  persistVariantSession,
} from "./variantSession";

const WORKFLOW: WorkflowRef = { id: "dev-flow", version: 1 };

/** The node the switch is sealed on — `model-variant`, the module under test's id. */
const NODE = "model-variant";

/** The record `model-variant` commits for the copy — the variant in every case here. */
const VARIANT = { variantModelId: 11, rootModelId: 1, title: "Base v1" };

/** A gateway that records the session PUTs it is asked to make; the other calls are not reached here. */
function recorder(): {
  gateway: ModelGateway;
  saved: { modelId: number; artefact: Artefact; workflow: WorkflowRef }[];
} {
  const saved: { modelId: number; artefact: Artefact; workflow: WorkflowRef }[] = [];
  const gateway: ModelGateway = {
    async createModel() {
      throw new Error("createModel is not used by the variant session write");
    },
    async updateModel() {
      throw new Error("updateModel is not used by the variant session write");
    },
    async saveSession(modelId, artefact, workflow) {
      saved.push({ modelId, artefact, workflow });
    },
    async loadSession() {
      return undefined;
    },
  };
  return { gateway, saved };
}

/** The switch, as `model-variant` commits it: the record and the moved `modelId`, one transaction. */
function switchTransaction(): DiffOp[] {
  return [
    {
      op: "replace",
      path: portPath("modelVariant"),
      prev: undefined,
      next: VARIANT,
    },
    { op: "replace", path: portPath("modelId"), prev: 1, next: 11 },
  ];
}

/** A live session that has just forked: a saved root model, then the switch sealed on the variant node. */
function switchedStore(): Store {
  const store = createStore({
    modelId: 1,
    modelName: "Base",
    fromDate: "2024-01-01",
    toDate: "2024-12-31",
  });
  store.applyTransaction(switchTransaction(), [], { node: { id: NODE } });
  return store;
}

describe("persistVariantSession", () => {
  it("writes the row under the variant's model id, through the session PUT", async () => {
    const { gateway, saved } = recorder();

    await persistVariantSession({ gateway, store: switchedStore(), workflow: WORKFLOW, variantModelId: 11 });

    expect(saved).toHaveLength(1);
    expect(saved[0]?.modelId).toBe(11);
    expect(saved[0]?.workflow).toEqual(WORKFLOW);
  });

  it("builds the row from the state after the switch — the log carries it, the projection is the store", async () => {
    const { gateway, saved } = recorder();

    await persistVariantSession({ gateway, store: switchedStore(), workflow: WORKFLOW, variantModelId: 11 });
    const artefact = saved[0]!.artefact;

    // The projection is the live store: the switch moved `modelId` onto the copy and recorded the variant.
    expect(artefact.projection.modelId).toBe(11);
    expect(artefact.projection.modelVariant).toEqual(VARIANT);
    // The switch is in the applied log — one transaction, on this node — replaying onto the root's own start.
    expect(artefact.initial.modelId).toBe(1);
    expect(artefact.log).toHaveLength(1);
    expect(artefact.log[0]?.nodeId).toBe(NODE);
    expect(artefact.cursor).toBe(1);
  });

  it("recomputes the fingerprint, so a load trusts the projection instead of replaying the switch away", async () => {
    const { gateway, saved } = recorder();

    await persistVariantSession({ gateway, store: switchedStore(), workflow: WORKFLOW, variantModelId: 11 });
    const artefact = saved[0]!.artefact;

    const { store, divergence } = fromArtefact(artefact);

    // No divergence: `fingerprint(projection)` matched what was stored, so the reload adopts it as-is. A stale
    // fingerprint over a patched projection is exactly the trap — it would be discarded and the log replayed.
    expect(divergence).toBeUndefined();
    expect(store.data.modelId).toBe(11);
    expect(store.data.modelVariant).toEqual(VARIANT);
  });
});

describe("createVariantSessionGuard", () => {
  it("claims a fork once, the moment its record appears, and never again", () => {
    const guard = createVariantSessionGuard();
    const store = createStore({ modelId: 1, modelName: "Base" });

    // First sight of the store: adopted, nothing owed yet.
    expect(guard.claim(store)).toBeUndefined();

    store.applyTransaction(switchTransaction(), [], { node: { id: NODE } });
    expect(guard.claim(store)).toEqual({ variantModelId: 11 }); // the fork — claimed

    // A re-render, and a later store change, are not a second fork.
    expect(guard.claim(store)).toBeUndefined();
    store.applyTransaction([{ op: "replace", path: portPath("modelName"), prev: "Base", next: "Base v1" }], [], {
      node: { id: "model-save" },
    });
    expect(guard.claim(store)).toBeUndefined();
  });

  it("holds nothing for a session that arrived already carrying a variant (a load owes no row)", () => {
    const guard = createVariantSessionGuard();
    const loaded = createStore({
      modelId: 11,
      modelVariant: VARIANT,
    });

    expect(guard.claim(loaded)).toBeUndefined();
    expect(guard.claim(loaded)).toBeUndefined();
  });

  it("treats a new store as a new session — a reset or a load claims nothing for what it carries", () => {
    const guard = createVariantSessionGuard();

    const first = createStore({ modelId: 1 });
    expect(guard.claim(first)).toBeUndefined();

    const loaded = createStore({
      modelId: 11,
      modelVariant: { variantModelId: 11, rootModelId: 1 },
    });
    expect(guard.claim(loaded)).toBeUndefined();
  });
});
