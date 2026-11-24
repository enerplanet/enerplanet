/**
 * The `model-save` node — what it seals, what it refuses, and the status it earns.
 *
 * The flow here has a node *before* the save, and that is load-bearing: "the model is complete" is a
 * statement about the *other* nodes, so a one-node flow would be complete before it started and could
 * never tell a finished save from an unfinished one.
 */
import { describe, it, expect } from "vitest";
import { createSaveNode, missingPorts, SaveRefused } from "./saveNode";
import type { LegacyModelPayload, ModelGateway } from "./gateway";
import { fromArtefact, type Artefact, type WorkflowRef } from "../core/artefact";
import type { Flow, ModuleRegistry } from "../core/flow";
import { createStore, type Store } from "../core/store";
import { createEngine } from "../core/engine";
import { createInvalidator } from "../core/invalidate";
import { portPath } from "../core/diff";
import { nodeStates } from "../core/position";
import { defineModule, requiredPorts, type Module } from "../core/module";
import { runInScratch } from "../core/testSupport";
import { seed } from "../core/fixtures";

const WORKFLOW: WorkflowRef = { id: "wf-core", version: 3 };
const UPSTREAM_ID = "start";
const NODE_ID = "model-save";

const RING: [number, number][] = [[8.6, 49.4], [8.7, 49.4], [8.7, 49.5], [8.6, 49.4]];

/** An upstream node that writes the area — what makes "every other node is done" observable. */
const upstream: Module = defineModule({
  id: UPSTREAM_ID,
  params: [{ port: "coordinates" }],
  affect: {},
  layout: [],
  // Reads before it writes: the write boundary refuses a blind overwrite of a port the seed already
  // holds, which is the same rule the real modules satisfy with `hold`/`read`.
  run: (ctx) => {
    ctx.read("coordinates");
    ctx.commit({ coordinates: [RING] });
  },
  validate: () => [],
});

const FLOW: Flow = [
  { id: UPSTREAM_ID, moduleId: UPSTREAM_ID },
  { id: NODE_ID, moduleId: NODE_ID },
];
const registry: ModuleRegistry = { [UPSTREAM_ID]: upstream };

/** The `saveSession` calls the node makes, in order — the artefact is what this file asserts on. */
type Session = { modelId: number; artefact: Artefact; workflow: WorkflowRef };

function gateway(recorded: LegacyModelPayload[], sessions: Session[] = []): ModelGateway {
  return {
    async createModel(payload) {
      recorded.push(payload);
      return { modelId: 42 };
    },
    async updateModel(_modelId, payload) {
      recorded.push(payload);
    },
    async saveSession(modelId, artefact, workflow) {
      sessions.push({ modelId, artefact, workflow });
    },
    async loadSession() {
      return undefined;
    },
  };
}

/** The node as the frame builds it: one session getter, because the node lives inside what it needs. */
function saveNodeFor(
  store: Store,
  payloads: LegacyModelPayload[] = [],
  identity: { workspaceId?: number; userId?: string } = {},
  sessions: Session[] = [],
  flow: Flow = FLOW,
): Module {
  return createSaveNode({
    session: () => ({
      gateway: gateway(payloads, sessions),
      store,
      workflow: WORKFLOW,
      flow,
      registry,
      ...identity,
    }),
  });
}

describe("createSaveNode", () => {
  it("declares the whole persisted surface, and requires the drawn area", () => {
    const node = saveNodeFor(createStore());

    expect(node.id).toBe(NODE_ID);
    expect(node.params.map((param) => param.port)).toContain("saveResult");
    // the backend resolves the country from the coordinates and refuses a model without them
    expect(requiredPorts(node)).toEqual(["coordinates"]);
  });

  it("binds to the session through getters, since it is part of the flow it is handed", () => {
    // The workflow cannot be built in one pass: this node is a member of the registry and the flow it
    // is given, so the factory takes getters and the frame fills them in after construction.
    const node = saveNodeFor(createStore());

    expect(FLOW.map((entry) => entry.moduleId)).toContain(node.id);
    expect(registry[NODE_ID]).toBeUndefined(); // the frame registers the built node itself
  });

  it("saves, then records the model id and the result in the store", async () => {
    const payloads: LegacyModelPayload[] = [];
    const store = createStore(seed({ coordinates: [RING] }));
    const node = saveNodeFor(store, payloads);

    await createEngine(store).runModule(node, { id: NODE_ID, moduleId: node.id });

    expect(payloads).toHaveLength(1);
    expect(payloads[0].title).toBe("Contract fixture");
    expect(store.data.modelId).toBe(42);
    expect(store.data.saveResult).toEqual({ modelId: 42, created: true });
    expect(store.log).toHaveLength(1);
    expect(store.log[0].node?.id).toBe(NODE_ID);
  });

  it("puts the model id and the result inside the artefact this save writes", async () => {
    // The bug this pins: the node persisted the session *before* it committed its record, so on the run that
    // first creates the model the two ports it records were absent from the artefact — and stayed absent, since
    // nothing made the node run again. The record has to travel inside Call B's artefact, so a reload reads it
    // without the node ever re-running.
    const payloads: LegacyModelPayload[] = [];
    const sessions: Session[] = [];
    const store = createStore(seed({ coordinates: [RING] }));
    const node = saveNodeFor(store, payloads, {}, sessions);

    await createEngine(store).runModule(node, { id: NODE_ID, moduleId: node.id });

    expect(sessions).toHaveLength(1);
    const artefact = sessions[0].artefact;
    expect(artefact.projection.modelId).toBe(42);
    expect(artefact.projection.saveResult).toEqual({ modelId: 42, created: true });

    // …and the artefact's fingerprint must match the projection it stored, or a load replays the log and reports
    // a divergence — the record is folded in before the digest is taken, so the reload trusts it as written.
    const loaded = fromArtefact(artefact);
    expect(loaded.divergence).toBeUndefined();
    expect(loaded.store.data.modelId).toBe(42);
    expect(loaded.store.data.saveResult).toEqual({ modelId: 42, created: true });
  });

  it("leaves the save node done on a reload, because the artefact records its own entry", async () => {
    // The half the projection-only fix could not reach. Committing after the save put the ports in the artefact
    // but not in its *log*, so a reloaded session showed the save node `pending` and the flow incomplete — and a
    // model that had been saved could never be re-saved as a complete one. Committing through the save's seam
    // seals the node's transaction before the session is written, so both the projection and the log carry it.
    const payloads: LegacyModelPayload[] = [];
    const sessions: Session[] = [];
    const store = createStore(seed({ coordinates: [RING] }));
    await createEngine(store).runModule(upstream, { id: UPSTREAM_ID, moduleId: upstream.id });
    const node = saveNodeFor(store, payloads, {}, sessions);
    await createEngine(store).runModule(node, { id: NODE_ID, moduleId: node.id });

    const loaded = fromArtefact(sessions[0].artefact);
    // The node is registered by the frame, not by this file's `registry` — pass it so the state can be derived.
    const withNode = { ...registry, [NODE_ID]: node };

    // The assertion is that the node has *history* on a reload, not that it reads `done`: this fixture's store is
    // deliberately thin, so the node's own gate reports the ports it persists as missing and it reads `stale` —
    // correct, and independent of the bug. `pending` is the state a missing log entry produces, which is what a
    // reload used to show.
    expect(loaded.store.log.map((t) => t.node?.id)).toContain(NODE_ID);
    expect(nodeStates(FLOW, withNode, loaded.store)[NODE_ID]).not.toBe("pending");
  });

  it("re-saves without clobbering the ids it already holds", async () => {
    const payloads: LegacyModelPayload[] = [];
    const store = createStore(
      seed({ coordinates: [RING], modelId: 12, saveResult: { modelId: 12, created: true } }),
    );
    const node = saveNodeFor(store, payloads);

    // The boundary refuses a blind overwrite, so the node has to read both ports first. A second run
    // is the case that proves it: on the first save they are absent.
    await expect(createEngine(store).runModule(node, { id: NODE_ID, moduleId: node.id })).resolves.toBeDefined();

    // …and because a modelId is already there, this is an UPDATE of that model, not a second create.
    expect(payloads).toHaveLength(1);
    expect(store.data.modelId).toBe(12);
    expect(store.data.saveResult).toEqual({ modelId: 12, created: false });
  });

  it("refuses a flow that cannot be saved yet, sealing nothing", async () => {
    const payloads: LegacyModelPayload[] = [];
    const store = createStore(seed({ coordinates: [] })); // nothing drawn
    const node = saveNodeFor(store, payloads);

    await expect(createEngine(store).runModule(node, { id: NODE_ID, moduleId: node.id })).rejects.toBeInstanceOf(SaveRefused);
    expect(payloads).toEqual([]); // nothing was sent
    expect(store.log).toEqual([]); // and nothing was sealed
  });
});

describe("the status this node earns", () => {
  it("promotes a finished flow to `draft`, so a run will accept it", async () => {
    // The case the getters exist for. Deriving the status from `position().complete` read false here —
    // this node *is* the unfinished one while it runs — so a finished model went out as `incomplete`
    // and no run would take it.
    const payloads: LegacyModelPayload[] = [];
    const store = createStore(seed({ coordinates: [RING] }));
    await createEngine(store).runModule(upstream, { id: UPSTREAM_ID, moduleId: upstream.id });

    await createEngine(store).runModule(saveNodeFor(store, payloads), { id: NODE_ID, moduleId: NODE_ID });

    expect(payloads[0].status).toBe("draft");
  });

  it("promotes a finished flow even with nodes after the save — the runs are pending while it saves", async () => {
    // The regression this covers: the status asked whether every *other* node was done, and the runs sit behind
    // the save by design, so they are pending and every save went out `incomplete` — which a run refuses. The
    // guards above all had the save last, which is why none of them caught it.
    const payloads: LegacyModelPayload[] = [];
    const store = createStore(seed({ coordinates: [RING] }));
    await createEngine(store).runModule(upstream, { id: UPSTREAM_ID, moduleId: upstream.id });

    const flow: Flow = [...FLOW, { id: "run-calliope", moduleId: "run-calliope" }];
    await createEngine(store).runModule(saveNodeFor(store, payloads, {}, [], flow), { id: NODE_ID, moduleId: NODE_ID });

    expect(payloads[0].status).toBe("draft");
  });

  it("saves a finished flow again as `modified`, not a second `draft`", async () => {
    const payloads: LegacyModelPayload[] = [];
    const store = createStore(seed({ coordinates: [RING], modelId: 12 }));
    await createEngine(store).runModule(upstream, { id: UPSTREAM_ID, moduleId: upstream.id });

    await createEngine(store).runModule(saveNodeFor(store, payloads), { id: NODE_ID, moduleId: NODE_ID });

    expect(payloads[0].status).toBe("modified");
  });
});

describe("the session's identity", () => {
  it("creates the model in the workspace the host reports now, not the one the session started with", async () => {
    // A workspace can load after the session was created, and a model created without one is invisible in the
    // dashboard, which lists models *within* a workspace. The live answer is the one that matters.
    const payloads: LegacyModelPayload[] = [];
    const store = createStore(seed({ coordinates: [RING], workspaceId: 1 }));
    await createEngine(store).runModule(upstream, { id: UPSTREAM_ID, moduleId: upstream.id });

    await createEngine(store).runModule(saveNodeFor(store, payloads, { workspaceId: 9 }), { id: NODE_ID, moduleId: NODE_ID });

    expect(payloads[0].workspace_id).toBe(9);
  });

  it("falls back to the store when the host has nothing to say", async () => {
    const payloads: LegacyModelPayload[] = [];
    const store = createStore(seed({ coordinates: [RING], workspaceId: 1 }));
    await createEngine(store).runModule(upstream, { id: UPSTREAM_ID, moduleId: upstream.id });

    await createEngine(store).runModule(saveNodeFor(store, payloads), { id: NODE_ID, moduleId: NODE_ID });

    expect(payloads[0].workspace_id).toBe(1);
  });
});

describe("the completeness gate", () => {
  it("names every persisted port the store does not hold, in the order to fix them", () => {
    // `seed()` carries the identity, the period, the area and an **empty** `buildings` collection — a port that
    // is present counts as present, whatever it holds. What is absent is the rest of the grid.
    const store = createStore(seed({ coordinates: [RING] }));

    expect(missingPorts(store.data).map((issue) => issue.port)).toEqual([
      "transformers",
      "lines",
      "mvLines",
      "grids",
    ]);
  });

  it("reports the same verdict through the node's validate()", async () => {
    const store = createStore(seed({ coordinates: [RING] }));
    const node = saveNodeFor(store);

    const { issues } = await runInScratch({ module: node, mock: seed({ coordinates: [RING] }) });

    expect(issues.map((issue) => issue.port)).toEqual([
      "transformers",
      "lines",
      "mvLines",
      "grids",
    ]);
  });

  it("says nothing when the model is whole", () => {
    const store = createStore(
      seed({
        coordinates: [RING],
        buildings: { type: "FeatureCollection", features: [] },
        transformers: { type: "FeatureCollection", features: [] },
        lines: { type: "FeatureCollection", features: [] },
        mvLines: { type: "FeatureCollection", features: [] },
        grids: [],
      }),
    );

    expect(missingPorts(store.data)).toEqual([]);
  });

  it("is a verdict, not a veto: an unfinished model still saves, as incomplete", async () => {
    // The split, pinned. The legacy refusal (no name, no period, no area) is what stops a save outright;
    // a missing *grid* is reported so the user knows what is left, while the model round-trips as `incomplete`.
    const payloads: LegacyModelPayload[] = [];
    const store = createStore(seed({ coordinates: [RING] }));
    const node = saveNodeFor(store, payloads);

    await createEngine(store).runModule(node, { id: NODE_ID, moduleId: node.id });

    expect(missingPorts(store.data).length).toBeGreaterThan(0);
    expect(payloads).toHaveLength(1);
    expect(payloads[0].status).toBe("incomplete");
  });
});

describe("the configuration the save persists", () => {
  it("goes stale when it is edited — pruning the result, never the model id", async () => {
    // The bug this pins: the node built its payload from the store but declared interests in only
    // `modelId`/`saveResult`, so no `affect` edge ran from the configuration to its outputs. Editing the
    // configuration therefore left the node `done` and the edit was never written back — a variant's run
    // then submitted the model **as stored**, i.e. the configuration it was copied with, not the one the
    // user just set. The whole point is that this edit must make the save stale.
    const payloads: LegacyModelPayload[] = [];
    // The registry the frame runs with: the save node is in it, or nothing declares the edge from the
    // configuration to the node's outputs and the store derives no cascade (`createInvalidator`).
    const modules: Record<string, Module> = { ...registry };
    const store = createStore(
      seed({
        coordinates: [RING],
        buildings: { type: "FeatureCollection", features: [] },
        transformers: { type: "FeatureCollection", features: [] },
        lines: { type: "FeatureCollection", features: [] },
        mvLines: { type: "FeatureCollection", features: [] },
        grids: [],
      }),
      { deriveCascade: createInvalidator(FLOW, modules) },
    );
    const node = saveNodeFor(store, payloads);
    modules[NODE_ID] = node;
    const withNode = { ...modules };

    // Save once: the node records the model id and the result.
    await createEngine(store).runModule(node, { id: NODE_ID, moduleId: node.id });
    expect(nodeStates(FLOW, withNode, store)[NODE_ID]).toBe("done");
    expect(store.data.modelId).toBe(42);

    // Now adjust the configuration the save persisted — a settings port it carries into `model.json`.
    // Omit the cascade, so the store derives it from the change through the invalidator.
    store.applyTransaction([
      { op: "replace", path: portPath("cookingCarrier"), prev: undefined, next: "gas" },
    ]);

    // The cascade pruned the save's *record* of the save: the stored model no longer matches the store.
    expect(store.data.saveResult).toBeUndefined();
    // …but never the model's identity. `modelId` does not change when the configuration does, and pruning it
    // would block the variant fork and both run nodes, every one of which requires it.
    expect(store.data.modelId).toBe(42);
    // And the node reads stale: it must run again before anything is run on the model as stored.
    expect(nodeStates(FLOW, withNode, store)[NODE_ID]).toBe("stale");
  });
});
