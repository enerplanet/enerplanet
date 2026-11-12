/**
 * The save node's logic (case T13).
 *
 * The payload assertions are **oracle tests**: the expected values are copied from
 * `saveService.ts` in `.local/ModularThesis/prototypes/sk-node-workflow/integration/`, which is a
 * verbatim extraction of the legacy `saveAreaData`. Parity is the reason this code exists, so the
 * shape is pinned against the legacy original rather than described.
 *
 * Written failing first.
 */
import { describe, it, expect } from "vitest";
import { buildModelPayload, buildSaveConfig, saveModel, type SaveRequest } from "./saveModel";
import type { LegacyModelPayload, ModelGateway } from "./gateway";
import type { Artefact, WorkflowRef } from "../core/artefact";
import type { Flow, ModuleRegistry } from "../core/flow";
import { createStore } from "../core/store";
import { createEngine } from "../core/engine";
import { defineModule } from "../core/module";
import { position } from "../core/position";
import { building, fc, seed } from "../core/fixtures";
import type { ModelData, PortKey } from "../core/ports";

const WORKFLOW: WorkflowRef = { id: "wf-core", version: 3 };

/** The legacy pypsa defaults, spelled exactly as the extracted legacy save hard-codes them. */
const LEGACY_TRAFO = "0.4 MVA 20/0.4 kV";
const LEGACY_LINE_MV = "NA2XS2Y 1x185 RM/25 12/20 kV";
const LEGACY_LINE_LV = "NAYY 4x150 SE";

/** Fixture dates: arbitrary, but repeated across the cases. */
const FROM_DATE = "2025-01-01";
const TO_DATE = "2025-12-31";

// ── a two-node flow, so "complete" is a real state ──────────────────────────

const REGION: PortKey = "region";
const COORDINATES: PortKey = "coordinates";

const start = defineModule({
  id: "start",
  params: [{ port: REGION }],
  affect: {},
  layout: [],
  run: (ctx) => ctx.commit({ region: { country: "DE", state: "BW" } }),
  validate: () => [],
});

const draw = defineModule({
  id: "draw",
  params: [{ port: REGION, required: true }, { port: COORDINATES }],
  affect: { region: [COORDINATES] },
  layout: [],
  run: (ctx) => {
    ctx.read(COORDINATES);
    ctx.commit({ coordinates: [[[8.6, 49.4], [8.7, 49.4], [8.7, 49.5], [8.6, 49.4]]] });
  },
  validate: () => [],
});

const registry: ModuleRegistry = { start, draw };
const FLOW: Flow = [
  { id: "start", moduleId: "start" },
  { id: "draw", moduleId: "draw" },
];

/** A complete session: both nodes have run and their outputs are still there. */
async function completeStore(): Promise<ReturnType<typeof createStore>> {
  const store = createStore(seed({ coordinates: [] }));
  const engine = createEngine(store);
  await engine.runModule(start, { id: "start" });
  await engine.runModule(draw, { id: "draw" });
  return store;
}

// ── a recording gateway ─────────────────────────────────────────────────────

interface Recorded {
  calls: string[];
  created?: LegacyModelPayload;
  updated?: { modelId: number; payload: LegacyModelPayload };
  session?: { modelId: number; artefact: Artefact; workflow: WorkflowRef };
}

function recorder(
  options: { nextModelId?: number; failSession?: string } = {},
): { gateway: ModelGateway; recorded: Recorded } {
  const recorded: Recorded = { calls: [] };

  const gateway: ModelGateway = {
    async createModel(payload) {
      recorded.calls.push("createModel");
      recorded.created = payload;
      return { modelId: options.nextModelId ?? 42 };
    },
    async updateModel(modelId, payload) {
      recorded.calls.push("updateModel");
      recorded.updated = { modelId, payload };
    },
    async saveSession(modelId, artefact, workflow) {
      recorded.calls.push("saveSession");
      recorded.session = { modelId, artefact, workflow };
      if (options.failSession !== undefined) throw new Error(options.failSession);
    },
    async loadSession() {
      recorded.calls.push("loadSession");
      return undefined;
    },
  };

  return { gateway, recorded };
}

function request(store: ReturnType<typeof createStore>, extra: Partial<SaveRequest> = {}): SaveRequest {
  return { store, workflow: WORKFLOW, flow: FLOW, registry, ...extra };
}

// ── the legacy payload (oracle) ─────────────────────────────────────────────

describe("T13 — the Call A payload is the legacy payload", () => {
  it("wraps the drawn rings into a MultiPolygon and defaults resolution to 60", () => {
    const ring: [number, number][] = [[8.6, 49.4], [8.7, 49.4], [8.7, 49.5], [8.6, 49.4]];
    const data: ModelData = { modelName: "  Demo  ", fromDate: FROM_DATE, toDate: TO_DATE, coordinates: [ring] };

    const payload = buildModelPayload(data, { status: "draft" });

    expect(payload.title).toBe("Demo"); // the legacy trimmed
    expect(payload.resolution).toBe(60); // …and defaulted
    expect(payload.coordinates).toEqual({ type: "MultiPolygon", coordinates: [[ring]] });
    expect(payload.from_date).toBe(FROM_DATE);
  });

  it("maps the store's ports onto the legacy config keys, mvLines included", () => {
    const data: ModelData = {
      buildings: fc([building("b1")]),
      lines: fc(),
      mvLines: fc([building("mv1")]),
      transformers: fc([building("t1")]),
      grids: [{ grid_result_id: 7 }],
    };

    const config = buildSaveConfig(data);

    expect(Object.keys(config).sort()).toEqual([
      "buildings",
      "grids",
      "lines",
      "mv_lines", // camelCase in the store, snake_case on the wire — the legacy key
      "pypsa",
      "transformers",
    ]);
    expect(config.mv_lines).toEqual(fc([building("mv1")]));
  });

  it("writes the legacy pypsa defaults, and honours pypsa_enabled false", () => {
    expect(buildSaveConfig({}).pypsa).toEqual({
      trafo_mv_lv_used: true,
      trafo_mv_lv_type: LEGACY_TRAFO,
      line_type_mv: LEGACY_LINE_MV,
      line_type_lv: LEGACY_LINE_LV,
    });

    const configured = buildSaveConfig({
      advancedParams: {
        pypsa_enabled: true,
        trafo_mv_lv_type: "0.63 MVA 20/0.4 kV",
        line_type_mv: "custom mv",
        line_type_lv: "custom lv",
      },
    });
    expect(configured.pypsa).toEqual({
      trafo_mv_lv_used: true,
      trafo_mv_lv_type: "0.63 MVA 20/0.4 kV",
      line_type_mv: "custom mv",
      line_type_lv: "custom lv",
    });

    expect(buildSaveConfig({ advancedParams: { pypsa_enabled: false } }).pypsa).toBe(false);
  });
});

// ── Call A then Call B ──────────────────────────────────────────────────────

describe("T13 — the save is two calls, A first", () => {
  it("creates the model as draft and hands its id to the session call", async () => {
    const store = await completeStore();
    expect(position(FLOW, registry, store).complete).toBe(true);
    const { gateway, recorded } = recorder({ nextModelId: 77 });

    const outcome = await saveModel(gateway, request(store));

    expect(recorded.calls).toEqual(["createModel", "saveSession"]);
    expect(recorded.created?.status).toBe("draft");
    expect(recorded.session?.modelId).toBe(77);
    expect(outcome).toEqual({ ok: true, modelId: 77, created: true, status: "draft", historySaved: true });
  });

  it("sends the T18 artefact to Call B, not the payload again", async () => {
    const store = await completeStore();
    const { gateway, recorded } = recorder();

    await saveModel(gateway, request(store));

    const artefact = recorded.session?.artefact;
    expect(recorded.session?.workflow).toEqual(WORKFLOW);
    expect(artefact?.workflow).toEqual(WORKFLOW);
    expect(artefact?.modelId).toBe(42);
    expect(artefact?.projection).toEqual(store.data);
    expect(artefact?.cursor).toBe(2); // both transactions
    expect(artefact?.discarded).toEqual([]);
    expect(artefact?.fingerprint).toBeTypeOf("string");
  });

  it("updates an existing model instead of creating one, and marks it modified", async () => {
    const store = await completeStore();
    const { gateway, recorded } = recorder();

    const outcome = await saveModel(gateway, request(store, { modelId: 12 }));

    expect(recorded.calls).toEqual(["updateModel", "saveSession"]);
    expect(recorded.updated?.modelId).toBe(12);
    expect(recorded.updated?.payload.status).toBe("modified");
    expect(outcome).toEqual({ ok: true, modelId: 12, created: false, status: "modified", historySaved: true });
  });
});

// ── the unfinished model ────────────────────────────────────────────────────

describe("T13 — an unfinished flow saves as incomplete, with an empty config", () => {
  it("marks it incomplete and infills an empty config while keeping what is known", async () => {
    const store = createStore(seed({ coordinates: [[[8.6, 49.4], [8.7, 49.4]]] }));
    const { gateway, recorded } = recorder();

    const outcome = await saveModel(gateway, request(store));

    expect(outcome).toMatchObject({ ok: true, status: "incomplete" });
    expect(recorded.created?.status).toBe("incomplete");
    expect(recorded.created?.config).toEqual({}); // the empty model.json, on purpose
    // …while the identity the legacy endpoint needs is still sent in full
    expect(recorded.created?.title).toBe("Contract fixture");
    expect(recorded.created?.from_date).toBe(FROM_DATE);
    expect(recorded.created?.coordinates.type).toBe("MultiPolygon");
  });

  it("refuses before calling anything when the legacy save would have refused", async () => {
    const { gateway, recorded } = recorder();
    const cases: Array<[Partial<ModelData>, string]> = [
      [{ modelName: "   " }, "missing-name"],
      [{ modelName: "Demo", fromDate: "", toDate: TO_DATE }, "missing-dates"],
      [{ modelName: "Demo", fromDate: FROM_DATE, toDate: TO_DATE, coordinates: [] }, "missing-coordinates"],
    ];

    for (const [data, reason] of cases) {
      const outcome = await saveModel(gateway, request(createStore(seed(data))));
      expect(outcome).toEqual({ ok: false, reason });
    }

    expect(recorded.calls).toEqual([]); // nothing was sent
  });
});

// ── the partial save ────────────────────────────────────────────────────────

describe("T13 — a session that fails to persist does not lose the model", () => {
  it("reports the partial save and still returns the model id", async () => {
    const store = await completeStore();
    const { gateway } = recorder({ nextModelId: 9, failSession: "session store is down" });

    const outcome = await saveModel(gateway, request(store));

    expect(outcome).toEqual({
      ok: true,
      modelId: 9,
      created: true,
      status: "draft",
      historySaved: false,
      historyError: "session store is down",
    });
  });

  it("lets a failed Call A propagate, because then nothing was saved", async () => {
    const store = await completeStore();
    const gateway: ModelGateway = {
      ...recorder().gateway,
      createModel: () => Promise.reject(new Error("coordinates are required to resolve country")),
    };

    await expect(saveModel(gateway, request(store))).rejects.toThrow(/coordinates are required/);
  });
});
