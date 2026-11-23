/**
 * `result-overview`'s tests.
 *
 * Two things are asserted, the same two worth asserting about any module: that its **declaration** is
 * consistent (`contractIssues`) and honest (`deriveInfluence`), and that its **behaviour** is what it claims —
 * through the real engine, and through the source slot's own state machine.
 *
 * The node is a **view**: it commits nothing. That is asserted directly — a run leaves its zero-diff trace and
 * changes no port — rather than left implied, because "declares ports but writes none" is the whole design.
 *
 * The summary arrives through the slot, so the source cases install a fake gateway and assert what the view
 * knows at each point: nothing before a request, loaded once a gateway arrives after the request (the
 * child-before-parent order a host hits), a failure reported, and one request per model.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  assertInfluenceHonest,
  contractIssues,
  createEngine,
  createStore,
  deriveInfluence,
  runInScratch,
  type MemeRun,
} from "@model-builder/core";
import resultOverview, { issuesFor, resultsPagePath } from "./index";
import {
  overviewState,
  requestResultOverview,
  resultOverviewGateway,
  setResultOverviewGateway,
  type ResultOverviewGateway,
  type ResultOverviewSummary,
} from "./source";

/** The node these cases run as — the module's own id, which is what a host uses in test mode. */
const NODE = resultOverview.module.id;

/** A Calliope run record, for the cases that seed or expect one. */
function run(status: MemeRun["status"], error?: string): MemeRun {
  return { framework: "calliope", status, ...(error === undefined ? {} : { error }) };
}

/** A summary, for the cases that seed or expect one. */
function summary(overrides: Partial<ResultOverviewSummary> = {}): ResultOverviewSummary {
  return {
    carriers: ["power"],
    locationCount: 3,
    sumProduction: 100,
    sumConsumption: 90,
    peakDemand: 5,
    timestepCount: 24,
    ...overrides,
  };
}

/** A gateway that answers with a fixed summary and remembers what it was asked. */
function fakeGateway(answers: {
  summary?: ResultOverviewSummary | Promise<ResultOverviewSummary>;
} = {}): ResultOverviewGateway & { asked: number[] } {
  const asked: number[] = [];
  return {
    asked,
    async summary(modelId) {
      asked.push(modelId);
      return answers.summary ?? summary();
    },
  };
}

/** Let every pending microtask/macrotask settle, so a fired-and-forgotten load has finished. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

// Every case starts from no gateway, so "no host installed one" is the honest default (the module has none).
beforeEach(() => {
  setResultOverviewGateway(null);
});

describe("result-overview's declaration", () => {
  it("is consistent with the contract", () => {
    expect(contractIssues(resultOverview)).toEqual([]);
  });

  it("is an interactive step, not an automatic one", () => {
    expect(resultOverview.module.auto).toBeUndefined();
  });

  it("requires the saved model and the run's record — the ports that place it after the run", () => {
    expect(
      resultOverview.module.params.filter((param) => param.required === true).map((p) => p.port).sort(),
    ).toEqual(["memeRun", "modelId"]);
    expect(resultOverview.module.params.map((param) => param.port).sort()).toEqual([
      "memeRun",
      "modelId",
    ]);
  });

  it("declares no influence — it writes nothing, so nothing of its own can be invalidated", () => {
    expect(resultOverview.module.affect).toEqual({});
  });

  it("declares a summary in the sidebar and a status strip below", () => {
    expect([...resultOverview.module.layout].sort()).toEqual(["bottom", "sidebar"]);
  });

  it("is honest about its influence — none, verified against the prober", async () => {
    const report = await deriveInfluence(resultOverview.module, { samples: resultOverview.mock ?? {} });
    expect(report.underDeclared).toEqual({});
    expect(() => assertInfluenceHonest(resultOverview.module.id, report)).not.toThrow();
  });
});

describe("result-overview's run", () => {
  it("writes nothing, and seals the zero-diff trace an interactive step needs", async () => {
    const { store, error, issues } = await runInScratch(resultOverview);

    expect(error).toBeUndefined();
    expect(issues).toEqual([]);
    // One trace, an empty primary: the run happened, and changed no port.
    expect(store.log).toHaveLength(1);
    expect(store.log[0]?.primary).toHaveLength(0);
    expect(store.data.modelId).toBe(resultOverview.mock?.modelId);
    expect(store.data.memeRun).toEqual(run("completed"));
  });

  it("is left behind after its run even on a store it does not touch", async () => {
    const store = createStore({ ...resultOverview.mock });
    const sealed = await createEngine(store).runModule(resultOverview.module, { id: NODE, moduleId: resultOverview.module.id });

    // The trace exists (so a jump's re-arm clears), and it carries no ops.
    expect(sealed?.primary).toHaveLength(0);
  });
});

describe("result-overview's gate", () => {
  it("says nothing once the run completed", () => {
    expect(issuesFor({ memeRun: run("completed") })).toEqual([]);
  });

  it("reports a run that has not happened, or is still going, as unfinished", () => {
    expect(issuesFor({})).toEqual([{ port: "memeRun", message: "The model has not been run yet." }]);
    expect(issuesFor({ memeRun: run("pending") })).toEqual([
      { port: "memeRun", message: "The Calliope run is still pending." },
    ]);
    expect(issuesFor({ memeRun: run("running") })).toEqual([
      { port: "memeRun", message: "The Calliope run is still running." },
    ]);
  });

  it("carries a failed run's message", () => {
    expect(issuesFor({ memeRun: run("failed", "meme said no") })).toEqual([
      { port: "memeRun", message: "The Calliope run failed: meme said no" },
    ]);
  });
});

describe("result-overview's source slot", () => {
  it("has no gateway until a host installs one", () => {
    expect(resultOverviewGateway()).toBeNull();
  });

  it("knows nothing before a request, and asks for nothing on a request without a gateway", async () => {
    requestResultOverview(101);
    await settle();

    expect(overviewState()).toEqual({ modelId: 101, summary: null, loading: false, failed: false });
  });

  it("loads the summary once a gateway arrives after the request — the child-before-parent order", async () => {
    // The view asks on mount, before the shell's install effect has run.
    requestResultOverview(102);

    const gateway = fakeGateway({ summary: summary({ carriers: ["power", "heat"], locationCount: 7 }) });
    setResultOverviewGateway(gateway);
    await settle();

    expect(gateway.asked).toEqual([102]);
    expect(overviewState()).toEqual({
      modelId: 102,
      summary: summary({ carriers: ["power", "heat"], locationCount: 7 }),
      loading: false,
      failed: false,
    });
  });

  it("loads at once when the gateway is already installed", async () => {
    const gateway = fakeGateway();
    setResultOverviewGateway(gateway);

    requestResultOverview(103);
    await settle();

    expect(gateway.asked).toEqual([103]);
    expect(overviewState().summary).toEqual(summary());
  });

  it("reports a failed fetch rather than an empty summary", async () => {
    const gateway: ResultOverviewGateway = {
      summary() {
        return Promise.reject(new Error("backend said no"));
      },
    };
    setResultOverviewGateway(gateway);

    requestResultOverview(104);
    await settle();

    expect(overviewState()).toEqual({ modelId: 104, summary: null, loading: false, failed: true });
  });

  it("asks once per model — a second request for the same model is not a second fetch", async () => {
    const gateway = fakeGateway();
    setResultOverviewGateway(gateway);

    requestResultOverview(105);
    await settle();
    requestResultOverview(105);
    await settle();

    expect(gateway.asked).toEqual([105]);
  });

  it("forgets a previous answer when a new gateway is installed", async () => {
    setResultOverviewGateway(fakeGateway());
    requestResultOverview(106);
    await settle();
    expect(overviewState().summary).not.toBeNull();

    // Uninstalling forgets both the answer and the pending request: with no gateway, nothing is owed.
    setResultOverviewGateway(null);
    expect(overviewState()).toEqual({ modelId: null, summary: null, loading: false, failed: false });
  });
});

describe("result-overview's results link", () => {
  it("points at the model's results page", () => {
    expect(resultsPagePath(42)).toBe("/app/model-results/42");
  });
});
