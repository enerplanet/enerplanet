/**
 * The `model-save` node (case T13) — what it seals, and what it refuses.
 *
 * Written failing first.
 */
import { describe, it, expect } from "vitest";
import { createSaveNode, SaveRefused } from "./saveNode";
import type { LegacyModelPayload, ModelGateway } from "./gateway";
import type { WorkflowRef } from "../core/artefact";
import type { Flow, ModuleRegistry } from "../core/flow";
import { createStore } from "../core/store";
import { createEngine } from "../core/engine";
import { requiredPorts } from "../core/module";
import { seed } from "../core/fixtures";

const WORKFLOW: WorkflowRef = { id: "wf-core", version: 3 };
const NODE_ID = "model-save";
const FLOW: Flow = [{ id: NODE_ID, moduleId: NODE_ID }];
const registry: ModuleRegistry = {};

const RING: [number, number][] = [[8.6, 49.4], [8.7, 49.4], [8.7, 49.5], [8.6, 49.4]];

function gateway(recorded: LegacyModelPayload[]): ModelGateway {
  return {
    async createModel(payload) {
      recorded.push(payload);
      return { modelId: 42 };
    },
    async updateModel(_modelId, payload) {
      recorded.push(payload);
    },
    async saveSession() {},
    async loadSession() {
      return undefined;
    },
  };
}

describe("createSaveNode", () => {
  it("declares the whole persisted surface, and requires the drawn area", () => {
    const node = createSaveNode({ gateway: gateway([]), store: createStore(), workflow: WORKFLOW, flow: FLOW, registry });

    expect(node.id).toBe(NODE_ID);
    expect(node.params.map((param) => param.port)).toContain("saveResult");
    // the backend resolves the country from the coordinates and refuses a model without them
    expect(requiredPorts(node)).toEqual(["coordinates"]);
  });

  it("saves, then records the model id and the result in the store", async () => {
    const payloads: LegacyModelPayload[] = [];
    const store = createStore(seed({ coordinates: [RING] }));
    const node = createSaveNode({ gateway: gateway(payloads), store, workflow: WORKFLOW, flow: FLOW, registry });

    await createEngine(store).runModule(node, { id: NODE_ID });

    expect(payloads).toHaveLength(1);
    expect(payloads[0].title).toBe("Contract fixture");
    expect(store.data.modelId).toBe(42);
    expect(store.data.saveResult).toEqual({ modelId: 42, created: true });
    expect(store.log).toHaveLength(1);
    expect(store.log[0].nodeId).toBe(NODE_ID);
  });

  it("re-saves without clobbering the ids it already holds", async () => {
    const payloads: LegacyModelPayload[] = [];
    const store = createStore(
      seed({ coordinates: [RING], modelId: 12, saveResult: { modelId: 12, created: true } }),
    );
    const node = createSaveNode({ gateway: gateway(payloads), store, workflow: WORKFLOW, flow: FLOW, registry });

    // The boundary refuses a blind overwrite, so the node has to read both ports first. A second run
    // is the case that proves it: on the first save they are absent.
    await expect(createEngine(store).runModule(node, { id: NODE_ID })).resolves.toBeDefined();

    // …and because a modelId is already there, this is an UPDATE of that model, not a second create.
    expect(payloads).toHaveLength(1);
    expect(store.data.modelId).toBe(12);
    expect(store.data.saveResult).toEqual({ modelId: 12, created: false });
  });

  it("refuses a flow that cannot be saved yet, sealing nothing", async () => {
    const payloads: LegacyModelPayload[] = [];
    const store = createStore(seed({ coordinates: [] })); // nothing drawn
    const node = createSaveNode({ gateway: gateway(payloads), store, workflow: WORKFLOW, flow: FLOW, registry });

    await expect(createEngine(store).runModule(node, { id: NODE_ID })).rejects.toBeInstanceOf(SaveRefused);
    expect(payloads).toEqual([]); // nothing was sent
    expect(store.log).toEqual([]); // and nothing was sealed
  });
});
