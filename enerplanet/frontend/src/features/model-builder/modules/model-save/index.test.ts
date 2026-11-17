/**
 * The `model-save` module's tests.
 *
 * This module reports rather than collects, so the cases here assert the three things it *does*: its
 * declaration is consistent, the `model.json` it would produce is the shape the backend is given, and the
 * node refuses to run until a host binds it a session.
 *
 * The conversion cases are the important ones. `model.json` is the one artefact where a mistake is
 * invisible until a round trip through the backend, so its shape is pinned here — and pinned against the
 * *builder*, not against a hand-written object, so this file cannot drift from what the save path sends.
 *
 * Written failing first.
 */
import { describe, it, expect } from "vitest";
import { contractIssues, createEngine, createStore, runInScratch } from "@model-builder/core";
import modelSave, { bindModelSaveSession, previewPayload } from "./index";
import type { LegacyModelPayload, ModelGateway } from "../../save/gateway";
import { NoSessionBound } from "../../save/saveNode";
import type { WorkflowRef } from "../../core/artefact";

const WORKFLOW: WorkflowRef = { id: "wf-core", version: 3 };
const NODE = modelSave.module.id;

/** A gateway that records what it was handed and creates a model the first time. */
function gateway(recorded: LegacyModelPayload[]): ModelGateway {
  return {
    async createModel(payload) {
      recorded.push(payload);
      return { modelId: 7 };
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

/** The session a host binds once the workflow exists — the shape, not the frame's instance of it. */
function sessionFor(store: ReturnType<typeof createStore>, payloads: LegacyModelPayload[] = []) {
  return {
    gateway: gateway(payloads),
    store,
    workflow: WORKFLOW,
    // The flow is only the save node here: "every other node is done" is then vacuously true, which is
    // the case that exercises the promotion rather than the refusal.
    flow: [{ id: NODE, moduleId: NODE }],
    registry: { [NODE]: modelSave.module },
  };
}

describe("the model-save module's declaration", () => {
  it("is consistent with the contract", () => {
    expect(contractIssues(modelSave)).toEqual([]);
  });

  it("declares the whole persisted surface, and requires the drawn area", () => {
    const declared = modelSave.module.params.map((param) => param.port);

    // Every port the legacy `model.json` carries. Nothing here is written by this node — they all arrive
    // from upstream — but declaring them is what makes the completeness gate and the flow gate possible.
    expect([...declared].sort()).toEqual([
      "advancedParams",
      "buildingParams",
      "buildings",
      "cookingCarrier",
      "coordinates",
      "draftId",
      "electricityPrices",
      "fromDate",
      "grids",
      "lines",
      "mode",
      "modelId",
      "modelName",
      "mvLines",
      "resolution",
      "saveResult",
      "technologies",
      "toDate",
      "transformers",
      "userId",
      "weatherSelection",
      "workspaceId",
    ]);
    // The backend resolves the country from `coordinates` and refuses a model without them.
    expect(modelSave.module.params.filter((param) => param.required === true).map((p) => p.port)).toEqual([
      "coordinates",
    ]);
  });

  it("renders in the sidebar and the status strip — no form, because nothing here is typed in", () => {
    expect([...modelSave.module.layout].sort()).toEqual(["bottom", "sidebar"]);
  });

  it("seals per commit, so its record is sealed before the session that must contain it", () => {
    // Deliberately NOT the default, and the reason is a save rather than a write. The node records
    // `modelId`/`saveResult` through the save's seam, between the two calls, because the artefact Call B writes
    // is where those ports have to appear — in its *log* as well as its projection, or a reloaded session shows
    // the node with no history at all: `pending`, and a flow that reads incomplete, so a saved model could never
    // be saved as a complete one again. `at-completion` buffers a commit until `run` returns, which is after
    // Call B, so the record could not be in the session at all.
    //
    // The atomicity this node still needs — id and result together, never one without the other — comes from
    // there being exactly one commit, made through one helper. Its history is one transaction either way: the
    // end-of-run flush adds nothing to a run that has already sealed.
    expect(modelSave.module.seal).toBe("per-commit");
  });

  it("reports the same verdict through `validate()` as the preview does", async () => {
    const { issues } = await runInScratch({ ...modelSave, mock: { resolution: 60 } });

    expect(issues.map((issue) => issue.port)).toEqual([
      "modelName",
      "fromDate",
      "toDate",
      "coordinates",
      "buildings",
      "transformers",
      "lines",
      "mvLines",
      "grids",
    ]);
  });
});

describe("the conversion output — the model.json this store produces", () => {
  it("builds the legacy shape from a complete store, and calls it a draft", () => {
    const store = createStore({ ...modelSave.mock });
    const payload = previewPayload(store.data);

    expect(payload.title).toBe("Example model");
    expect(payload.from_date).toBe("2025-01-01");
    expect(payload.to_date).toBe("2025-12-31");
    expect(payload.resolution).toBe(60);
    // The legacy wraps each drawn ring into a polygon: `polygonCoordinates.map(p => [p])`.
    expect(payload.coordinates).toEqual({
      type: "MultiPolygon",
      coordinates: [[modelSave.mock?.coordinates?.[0]]],
    });
    // camelCase in the store, snake_case on the wire — the mapping parity tests exist to hold still.
    expect(Object.keys(payload.config as Record<string, unknown>).sort()).toEqual([
      "buildings",
      "grids",
      "lines",
      "mv_lines",
      "pypsa",
      "transformers",
    ]);
    expect(payload.status).toBe("draft");
  });

  it("sends an empty config for an unfinished model, and says so", () => {
    // The split: there is no model yet, so Call A carries `{}` rather than a config full of defaults,
    // and the status is what tells a legacy consumer the model is not runnable. The real state travels
    // in Call B's artefact either way.
    const store = createStore({
      modelName: "Half-built",
      fromDate: "2025-01-01",
      toDate: "2025-12-31",
      resolution: 60,
      coordinates: [[[8.6, 49.4], [8.7, 49.4], [8.7, 49.5]]],
    });

    const payload = previewPayload(store.data);

    expect(payload.config).toEqual({});
    expect(payload.status).toBe("incomplete");
  });

  it("calls a re-save of a complete model `modified`, not a second `draft`", () => {
    const store = createStore({ ...modelSave.mock, modelId: 12 });

    expect(previewPayload(store.data).status).toBe("modified");
  });
});

describe("the session the node reads", () => {
  it("refuses to run while no host has bound a session", async () => {
    // The node is *declared* without one — that is what keeps the flow valid and the `required` gate
    // meaningful — but running it must not act on a session that is not there.
    bindModelSaveSession(null);
    const store = createStore({ ...modelSave.mock });

    await expect(createEngine(store).runModule(modelSave.module, { id: NODE })).rejects.toBeInstanceOf(
      NoSessionBound,
    );
    expect(store.log).toEqual([]); // and nothing was sealed
  });

  it("saves once bound, recording the model id and the result", async () => {
    const payloads: LegacyModelPayload[] = [];
    const store = createStore({ ...modelSave.mock });
    bindModelSaveSession(sessionFor(store, payloads));

    await createEngine(store).runModule(modelSave.module, { id: NODE });

    expect(payloads).toHaveLength(1);
    expect(payloads[0].status).toBe("draft");
    expect(store.data.modelId).toBe(7);
    expect(store.data.saveResult).toEqual({ modelId: 7, created: true });
  });
});
