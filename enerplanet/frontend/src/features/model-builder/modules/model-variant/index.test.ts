/** `model-variant`'s tests: its declaration, and its behaviour through the real engine. */
import { beforeEach, describe, expect, it } from "vitest";
import {
  assertInfluenceHonest,
  contractIssues,
  createEngine,
  createStore,
  deriveInfluence,
  runInScratch,
  type ModelVariant,
} from "@model-builder/core";
import modelVariant, { issuesFor } from "./index";
import { setModelVariantGateway, type ModelVariantGateway } from "./source";

/** The node these cases run as — the module's own id, which is what a host uses in test mode. */
const NODE = modelVariant.module.id;

/** A variant record, for the cases that seed or expect one. */
function variant(overrides: Partial<ModelVariant> = {}): ModelVariant {
  return { variantModelId: 11, rootModelId: 1, title: "Base v1", ...overrides };
}

/** A gateway that answers from a script and remembers what it was asked, keyed by model id. */
function fakeGateway(answer?: ModelVariant): ModelVariantGateway & { asked: number[] } {
  const asked: number[] = [];
  return {
    asked,
    async createVariant(modelId) {
      asked.push(modelId);
      return answer ?? variant({ variantModelId: modelId * 10 + 1, rootModelId: modelId });
    },
  };
}

beforeEach(() => {
  // Every case starts from no gateway; a case that wants one installs it.
  setModelVariantGateway(null);
});

describe("model-variant's declaration", () => {
  it("is consistent with the contract", () => {
    expect(contractIssues(modelVariant)).toEqual([]);
  });

  it("is an interactive step, not an automatic one", () => {
    expect(modelVariant.module.auto).toBeUndefined();
  });

  it("requires the saved model and declares the variant it writes", () => {
    expect(
      modelVariant.module.params.filter((param) => param.required === true).map((p) => p.port),
    ).toEqual(["modelId"]);
    expect(modelVariant.module.params.map((param) => param.port).sort()).toEqual([
      "modelId",
      "modelVariant",
    ]);
  });

  it("declares the one edge — a different saved model invalidates the variant it made", () => {
    expect([...modelVariant.module.affect.modelId!]).toEqual(["modelVariant"]);
  });

  it("declares a form in the sidebar and a status strip below", () => {
    expect([...modelVariant.module.layout].sort()).toEqual(["bottom", "sidebar"]);
  });

  it("leaves seal at its default — one record, one writer, one transaction", () => {
    expect(modelVariant.module.seal).toBeUndefined();
  });

  it("is honest about its influence, verified against the prober", async () => {
    setModelVariantGateway(fakeGateway());
    const report = await deriveInfluence(modelVariant.module, { samples: modelVariant.mock ?? {} });

    expect(report.underDeclared).toEqual({});
    expect(report.overDeclared).toEqual({});
    expect(() => assertInfluenceHonest(modelVariant.module.id, report)).not.toThrow();
  });
});

describe("model-variant's run", () => {
  it("creates the copy once and commits the record the gateway answered", async () => {
    const gateway = fakeGateway();
    setModelVariantGateway(gateway);

    const { store, error } = await runInScratch(modelVariant);

    expect(error).toBeUndefined();
    expect(gateway.asked).toEqual([modelVariant.mock?.modelId]);
    expect(store.data.modelVariant).toEqual(variant({ variantModelId: 11, rootModelId: 1 }));
  });

  it("switches this page onto the copy, in the same transaction as the record", async () => {
    const gateway = fakeGateway();
    setModelVariantGateway(gateway);

    const { store, error } = await runInScratch(modelVariant);

    expect(error).toBeUndefined();
    // The switch: `modelId` moves onto the copy, so the store renders the variant in this same page.
    expect(store.data.modelId).toBe(11);
    expect(store.data.modelVariant).toEqual(variant({ variantModelId: 11, rootModelId: 1 }));
    // One record, one transaction — both ports, stamped on this node.
    expect(store.log).toHaveLength(1);
    expect(store.log[0]?.node?.id).toBe(NODE);
    expect(store.log[0]?.primary.map((op) => op.path).sort()).toEqual(["/modelId", "/modelVariant"]);
  });

  it("creates nothing a second time when a variant is already recorded", async () => {
    const gateway = fakeGateway();
    setModelVariantGateway(gateway);

    const store = createStore({ ...modelVariant.mock, modelVariant: variant() });
    await createEngine(store).runModule(modelVariant.module, { id: NODE, moduleId: modelVariant.module.id });

    // A recorded variant means the copy was already made, so pressing again must not fork a second.
    expect(gateway.asked).toEqual([]);
    expect(store.data.modelVariant).toEqual(variant());
    // The step is still sealed — a zero-diff trace — so the node can be left behind.
    expect(store.log).toHaveLength(1);
    expect(store.log[0]?.primary).toHaveLength(0);
  });

  it("says so plainly when no host installed a gateway, and names the installer", async () => {
    const { error } = await runInScratch(modelVariant);

    expect(error?.message).toContain("no variant gateway");
    expect(error?.message).toContain("setModelVariantGateway");
  });
});

describe("model-variant's gate", () => {
  it("says nothing once a variant has been made", () => {
    expect(issuesFor({ modelVariant: variant() })).toEqual([]);
  });

  it("reports a variant that has not been made yet — which keeps the session on this node", () => {
    expect(issuesFor({})).toEqual([
      { port: "modelVariant", message: "No variant of this model has been made yet." },
    ]);
  });
});
