/**
 * The Loader — the mirror of the save: adopt the artefact, reattach the flow by reference, and
 * re-derive the states.
 *
 * Written failing first.
 */
import { describe, it, expect } from "vitest";
import { loadSession } from "./loader";
import type { Artefact, WorkflowRef } from "../core/artefact";
import { toArtefact } from "../core/artefact";
import type { ModelGateway } from "../save/gateway";
import type { Flow, ModuleRegistry } from "../core/flow";
import { createStore } from "../core/store";
import { defineModule } from "../core/module";
import { seed } from "../core/fixtures";
import type { PortKey } from "../core/ports";

const WORKFLOW: WorkflowRef = { id: "wf-core", version: 3 };
const REGION: PortKey = "region";

const start = defineModule({
  id: "start",
  params: [{ port: REGION }],
  affect: {},
  layout: [],
  run: (ctx) => ctx.commit({ region: { country: "DE", state: "BW" } }),
  validate: () => [],
});

const registry: ModuleRegistry = { start };
const FLOW: Flow = [{ id: "start", moduleId: "start" }];

function gatewayWith(artefact: Artefact | undefined): ModelGateway {
  return {
    async createModel() {
      return { modelId: 1 };
    },
    async updateModel() {},
    async saveSession() {},
    async loadSession() {
      return artefact;
    },
  };
}

/** A session whose one transaction belongs to the `start` node, so the flow can be reattached. */
function savedSession(): Artefact {
  const store = createStore(seed());
  store.applyTransaction(
    [{ op: "replace", path: "/region", prev: undefined, next: { country: "DE", state: "BW" } }],
    [],
    { node: { id: "start" } },
  );
  return toArtefact({ store, workflow: WORKFLOW, modelId: 7 });
}

describe("loadSession", () => {
  it("adopts the artefact and re-derives the flow state from the log", async () => {
    const outcome = await loadSession({
      gateway: gatewayWith(savedSession()),
      modelId: 7,
      flow: FLOW,
      registry,
    });

    if (outcome.kind !== "session") throw new Error(`expected a session, got ${outcome.kind}`);

    expect(outcome.session.store.data.region).toEqual({ country: "DE", state: "BW" });
    expect(outcome.session.store.cursor).toBe(1);
    expect(outcome.session.divergence).toBeUndefined();
    // The flow was reattached by the caller, and the node reads as done — derived, not stored.
    expect(outcome.session.states).toEqual({ start: "done" });
    expect(outcome.session.position).toMatchObject({ index: 1, complete: true });
  });

  it("reports the divergence when the stored projection disagreed with its fingerprint", async () => {
    const artefact = savedSession();
    artefact.projection = { ...artefact.projection, region: { country: "XX", state: "YY" } };

    const outcome = await loadSession({ gateway: gatewayWith(artefact), modelId: 7, flow: FLOW, registry });

    if (outcome.kind !== "session") throw new Error("expected a session");

    expect(outcome.session.divergence).toBeDefined();
    // The log is the source of truth, so the tampered region is gone, not adopted.
    expect(outcome.session.store.data.region).toEqual({ country: "DE", state: "BW" });
  });

  it("reports a model with no session as an answer, not an error", async () => {
    const outcome = await loadSession({ gateway: gatewayWith(undefined), modelId: 7, flow: FLOW, registry });

    expect(outcome).toEqual({ kind: "none" });
  });
});
