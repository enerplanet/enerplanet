/**
 * `compare-variant`'s tests.
 *
 * Two things are asserted, the same two worth asserting about any module: that its **declaration** is
 * consistent (`contractIssues`) and honest (`deriveInfluence`), and that its **behaviour** is what it claims —
 * through the real engine, and through the source slot's own state machine.
 *
 * The node is a **view**: it commits nothing. That is asserted directly — a run leaves its zero-diff trace and
 * changes no port — rather than left implied, because "declares a port but writes none" is the whole design.
 *
 * Both sides arrive through the slot, so the source cases install a fake gateway and assert what the view knows
 * at each point: nothing before a request, both sides loaded once a gateway arrives after the request (the
 * child-before-parent order a host hits), a per-side failure and a per-side absence reported as the two
 * different things they are, and one request per pair.
 */
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
import compareVariant, { comparePath, issuesFor } from "./index";
import {
  compareVariantGateway,
  compareVariantState,
  requestCompareVariant,
  setCompareVariantGateway,
  type CompareVariantGateway,
  type CompareVariantSummary,
} from "./source";

/** The node these cases run as — the module's own id, which is what a host uses in test mode. */
const NODE = compareVariant.module.id;

/** A variant record, for the cases that seed or expect one. */
function variant(overrides: Partial<ModelVariant> = {}): ModelVariant {
  return { variantModelId: 11, rootModelId: 1, title: "Base v1", ...overrides };
}

/** A summary, for the cases that seed or expect one. */
function summary(overrides: Partial<CompareVariantSummary> = {}): CompareVariantSummary {
  return { sumProduction: 100, sumConsumption: 90, peakDemand: 5, ...overrides };
}

/**
 * A gateway that answers from a script and remembers what it was asked. The default answer is keyed by the
 * model id, so a per-side difference is visible.
 */
function fakeGateway(
  answer: (modelId: number) => CompareVariantSummary | null = (modelId) =>
    summary({ sumProduction: modelId }),
): CompareVariantGateway & { asked: number[] } {
  const asked: number[] = [];
  return {
    asked,
    async summary(modelId) {
      asked.push(modelId);
      return answer(modelId);
    },
  };
}

/** Let every pending microtask/macrotask settle, so a fired-and-forgotten load has finished. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

// Every case starts from no gateway, so "no host installed one" is the honest default (the module has none).
beforeEach(() => {
  setCompareVariantGateway(null);
});

describe("compare-variant's declaration", () => {
  it("is consistent with the contract", () => {
    expect(contractIssues(compareVariant)).toEqual([]);
  });

  it("is an interactive step, not an automatic one", () => {
    expect(compareVariant.module.auto).toBeUndefined();
  });

  it("requires the variant record — the port that places it after the variant", () => {
    expect(
      compareVariant.module.params.filter((param) => param.required === true).map((p) => p.port),
    ).toEqual(["modelVariant"]);
    expect(compareVariant.module.params.map((param) => param.port)).toEqual(["modelVariant"]);
  });

  it("declares no influence — it writes nothing, so nothing of its own can be invalidated", () => {
    expect(compareVariant.module.affect).toEqual({});
  });

  it("declares a comparison in the sidebar and a status strip below", () => {
    expect([...compareVariant.module.layout].sort()).toEqual(["bottom", "sidebar"]);
  });

  it("is honest about its influence — none, verified against the prober", async () => {
    const report = await deriveInfluence(compareVariant.module, {
      samples: compareVariant.mock ?? {},
    });
    expect(report.underDeclared).toEqual({});
    expect(() => assertInfluenceHonest(compareVariant.module.id, report)).not.toThrow();
  });
});

describe("compare-variant's run", () => {
  it("writes nothing, and seals the zero-diff trace an interactive step needs", async () => {
    const { store, error, issues } = await runInScratch(compareVariant);

    expect(error).toBeUndefined();
    expect(issues).toEqual([]);
    // One trace, an empty primary: the run happened, and changed no port.
    expect(store.log).toHaveLength(1);
    expect(store.log[0]?.primary).toHaveLength(0);
    expect(store.data.modelVariant).toEqual(compareVariant.mock?.modelVariant);
  });

  it("is left behind after its run even on a store it does not touch", async () => {
    const store = createStore({ ...compareVariant.mock });
    const sealed = await createEngine(store).runModule(compareVariant.module, { id: NODE, moduleId: compareVariant.module.id });

    // The trace exists (so the placement reads `done`), and it carries no ops.
    expect(sealed?.primary).toHaveLength(0);
  });
});

describe("compare-variant's gate", () => {
  it("says nothing once a variant has been recorded — a variant with no results is still comparable", () => {
    // The variant's own results are not this node's gate: a freshly made variant has none, and demanding them
    // would deadlock the flow. Presence of the record is all that is required — the counts below are irrelevant
    // to the gate, and that is the point.
    expect(issuesFor({ modelVariant: variant() })).toEqual([]);
    expect(issuesFor({ modelVariant: variant({ variantModelId: 99, title: undefined }) })).toEqual([]);
  });

  it("reports a variant that has not been made yet — nothing to compare", () => {
    expect(issuesFor({})).toEqual([
      {
        port: "modelVariant",
        message: "No variant of this model has been made yet, so there is nothing to compare.",
      },
    ]);
  });
});

describe("compare-variant's source slot", () => {
  it("has no gateway until a host installs one", () => {
    expect(compareVariantGateway()).toBeNull();
  });

  it("records the pair but asks nothing without a gateway", async () => {
    requestCompareVariant(1, 11);
    await settle();

    expect(compareVariantState()).toEqual({
      root: { status: "loading", summary: null },
      variant: { status: "loading", summary: null },
    });
  });

  it("loads both sides once a gateway arrives after the request — the child-before-parent order", async () => {
    // The view asks on mount, before the shell's install effect has run.
    requestCompareVariant(1, 11);

    const gateway = fakeGateway();
    setCompareVariantGateway(gateway);
    await settle();

    // Both legs were asked, in root-then-variant order.
    expect(gateway.asked).toEqual([1, 11]);
    expect(compareVariantState()).toEqual({
      root: { status: "ready", summary: summary({ sumProduction: 1 }) },
      variant: { status: "ready", summary: summary({ sumProduction: 11 }) },
    });
  });

  it("loads at once when the gateway is already installed", async () => {
    const gateway = fakeGateway();
    setCompareVariantGateway(gateway);

    requestCompareVariant(2, 12);
    await settle();

    expect(gateway.asked).toEqual([2, 12]);
    expect(compareVariantState().variant.status).toBe("ready");
  });

  it("reports a side with no results as empty, not as a zero or a failure", async () => {
    // The variant has not been run: the endpoint answers it with no data.
    const gateway = fakeGateway((modelId) => (modelId === 12 ? null : summary()));
    setCompareVariantGateway(gateway);

    requestCompareVariant(2, 12);
    await settle();

    expect(compareVariantState()).toEqual({
      root: { status: "ready", summary: summary() },
      variant: { status: "empty", summary: null },
    });
  });

  it("reports a failed fetch rather than an empty side", async () => {
    const gateway: CompareVariantGateway = {
      summary() {
        return Promise.reject(new Error("backend said no"));
      },
    };
    setCompareVariantGateway(gateway);

    requestCompareVariant(1, 11);
    await settle();

    expect(compareVariantState()).toEqual({
      root: { status: "failed", summary: null },
      variant: { status: "failed", summary: null },
    });
  });

  it("asks once per pair — a second request for the same pair is not a second fetch", async () => {
    const gateway = fakeGateway();
    setCompareVariantGateway(gateway);

    requestCompareVariant(1, 11);
    await settle();
    requestCompareVariant(1, 11);
    await settle();

    expect(gateway.asked).toEqual([1, 11]);
  });

  it("forgets a previous answer when a new gateway is installed", async () => {
    setCompareVariantGateway(fakeGateway());
    requestCompareVariant(1, 11);
    await settle();
    expect(compareVariantState().root.status).toBe("ready");

    // Uninstalling forgets both the answers and the pending pair: with no gateway, nothing is owed.
    setCompareVariantGateway(null);
    expect(compareVariantState()).toEqual({
      root: { status: "loading", summary: null },
      variant: { status: "loading", summary: null },
    });
  });
});

describe("compare-variant's comparison link", () => {
  it("seeds both sides of the compare page from the family's two ids", () => {
    expect(comparePath(1, 42)).toBe("/app/simulation-reports?model1=1&model2=42");
  });
});
