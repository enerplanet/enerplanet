/**
 * `run-meme-calliope`'s tests.
 *
 * Two things are asserted, the same two worth asserting about any module: that its **declaration** is
 * consistent (`contractIssues`), and that its **behaviour** is what it claims (through the real engine).
 *
 * The run arrives through a slot, so every behaviour case installs a fake gateway and asserts what the module
 * *does with the answers*: submits once on arrival, submits nothing when a run is already recorded, commits the
 * outcome when the run lands, and reports a failure. The poll itself is not waited on — the outcome-commit is
 * the very `run()` the poll calls, so the cases drive `run()` directly and no test sleeps.
 *
 * Written failing first.
 */
import { describe, expect, it, beforeEach } from "vitest";
import {
  contractIssues,
  createEngine,
  createStore,
  runInScratch,
  type MemeRun,
} from "@model-builder/core";
import { createInvalidator } from "../../core/invalidate";
import type { DiffOp } from "../../core/diff";
import runMemeCalliope, { issuesFor } from "./index";

  it("is invalidated when the model is saved again, so an edited model is run again", () => {
    // A run consumes the *saved* model, and an edit re-saves under the same id: `saveResult` moves, `modelId`
    // never does. Without this edge a completed run stood for the rest of the session and the adjusted model the
    // variant flow exists to run could not be run at all.
    const store = createStore({
      ...runMemeCalliope.mock,
      memeRun: run("completed"),
      saveResult: { modelId: 7, created: true },
    });
    const primary: DiffOp[] = [
      { op: "replace", path: "saveResult", prev: store.data.saveResult, next: { modelId: 7, created: false } },
    ];

    const cascade = createInvalidator(
      [{ id: runMemeCalliope.module.id, moduleId: runMemeCalliope.module.id }],
      { [runMemeCalliope.module.id]: runMemeCalliope.module },
    )(primary, store.data);

    expect(cascade.map((op) => op.path)).toContain("/memeRun");
  });

import { setMemeRunGateway, type MemeRunGateway } from "./source";

/** The node these cases run as — the module's own id, which is what a host uses in test mode. */
const NODE = runMemeCalliope.module.id;

/** A Calliope run record, for the cases that seed or expect one. */
function run(status: MemeRun["status"], error?: string): MemeRun {
  return { framework: "calliope", status, ...(error === undefined ? {} : { error }) };
}

/** The failure message a run can carry, named once so the cases speak about the same thing. */
const FAILURE = "meme said no";

/**
 * A gateway that answers from a script and remembers what it was asked. `status` may be a single answer (every
 * read) or a queue (one per read), so a case can drive a run through several states.
 */
function fakeGateway(answers: { submit?: MemeRun; status?: MemeRun | MemeRun[] } = {}): MemeRunGateway & {
  submitted: number[];
  polled: number[];
} {
  const submitted: number[] = [];
  const polled: number[] = [];
  const queue = Array.isArray(answers.status)
    ? [...answers.status]
    : answers.status === undefined
      ? []
      : [answers.status];

  return {
    submitted,
    polled,
    async submit(modelId) {
      submitted.push(modelId);
      return answers.submit ?? run("pending");
    },
    async status(modelId) {
      polled.push(modelId);
      return queue.shift() ?? run("running");
    },
  };
}

beforeEach(() => {
  // Every case starts from no gateway; a case that wants one installs it.
  setMemeRunGateway(null);
});

describe("run-meme-calliope's declaration", () => {
  it("is consistent with the contract", () => {
    expect(contractIssues(runMemeCalliope)).toEqual([]);
  });

  it("declares itself an automatic step — nothing for the user to collect", () => {
    expect(runMemeCalliope.module.auto).toBe(true);
  });

  it("requires the saved model, and declares the run record it writes", () => {
    expect(
      runMemeCalliope.module.params.filter((param) => param.required === true).map((p) => p.port),
    ).toEqual(["modelId"]);
    expect(runMemeCalliope.module.params.map((param) => param.port).sort()).toEqual([
      "memeRun",
      "modelId",
      "saveResult",
    ]);
  });

  it("declares both edges — a different model, and a model saved again", () => {
    // `modelId` moves when the model is created; `saveResult` moves on every save, which is what an edit produces.
    expect([...runMemeCalliope.module.affect.modelId!]).toEqual(["memeRun"]);
    expect([...runMemeCalliope.module.affect.saveResult!]).toEqual(["memeRun"]);
    expect(runMemeCalliope.module.affect.memeRun).toBeUndefined();
  });

  it("declares the two regions an auto node shows into, and no forward action", () => {
    expect([...runMemeCalliope.module.layout].sort()).toEqual(["bottom", "overlay"]);
  });

  it("leaves seal at its default — one record, one writer, one transaction", () => {
    // `at-completion` is the default, so the module does not declare it and does not opt into `per-commit`.
    expect(runMemeCalliope.module.seal).toBeUndefined();
  });
});

describe("run-meme-calliope's run", () => {
  it("reads the model first, then submits, when nothing has been started", async () => {
    // The model reports nothing started, which is what one that has never been run looks like through the
    // gateway: `draft` and its friends land on `failed`. Without this answer the fake defaults to a run already
    // going, which is the case below.
    const gateway = fakeGateway({ submit: run("pending"), status: run("failed") });
    setMemeRunGateway(gateway);

    const { store, error } = await runInScratch(runMemeCalliope);

    expect(error).toBeUndefined();
    expect(gateway.polled).toEqual([runMemeCalliope.mock?.modelId]);
    expect(gateway.submitted).toEqual([runMemeCalliope.mock?.modelId]);
    expect(store.data.memeRun).toEqual(run("pending"));
  });

  it("continues a run it finds already going instead of starting a second one", async () => {
    // A reopened session restores without the run's record, so arrival happens again — and the model may already
    // be running. Submitting from nothing here is what dispatched a duplicate calculation; the read is what tells
    // a session continuing a run from one starting it.
    const gateway = fakeGateway({ status: run("running") });
    setMemeRunGateway(gateway);

    const { store, error } = await runInScratch(runMemeCalliope);

    expect(error).toBeUndefined();
    expect(gateway.submitted).toEqual([]);
    expect(store.data.memeRun?.status).toBe("running");
  });

  it("adopts a run that has already finished, rather than running the model again", async () => {
    const gateway = fakeGateway({ status: run("completed") });
    setMemeRunGateway(gateway);

    const { store, error } = await runInScratch(runMemeCalliope);

    expect(error).toBeUndefined();
    expect(gateway.submitted).toEqual([]);
    expect(store.data.memeRun?.status).toBe("completed");
  });

  it("submits nothing when the store already holds a run record", async () => {
    const gateway = fakeGateway({ status: run("running") });
    setMemeRunGateway(gateway);

    const store = createStore({ ...runMemeCalliope.mock, memeRun: run("running") });
    await createEngine(store).runModule(runMemeCalliope.module, { id: NODE, moduleId: runMemeCalliope.module.id });

    // The backend refuses a duplicate live run and the submit is idempotent, so a second POST would be both
    // wrong and wasteful: an existing record means read, never resubmit.
    expect(gateway.submitted).toEqual([]);
    expect(gateway.polled).toEqual([runMemeCalliope.mock?.modelId]);
  });

  it("commits the outcome when the run has completed, and the gate goes clean", async () => {
    const gateway = fakeGateway({ status: run("completed") });
    setMemeRunGateway(gateway);

    const store = createStore({ ...runMemeCalliope.mock, memeRun: run("running") });
    await createEngine(store).runModule(runMemeCalliope.module, { id: NODE, moduleId: runMemeCalliope.module.id });

    expect(store.data.memeRun).toEqual(run("completed"));
    expect(issuesFor(store.data)).toEqual([]);
  });

  it("reports a failed run, carrying the message", async () => {
    const gateway = fakeGateway({ status: run("failed", FAILURE) });
    setMemeRunGateway(gateway);

    const store = createStore({ ...runMemeCalliope.mock, memeRun: run("running") });
    await createEngine(store).runModule(runMemeCalliope.module, { id: NODE, moduleId: runMemeCalliope.module.id });

    expect(store.data.memeRun).toEqual(run("failed", FAILURE));
    const issues = issuesFor(store.data);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.port).toBe("memeRun");
    expect(issues[0]?.message).toContain(FAILURE);
  });

  it("submits a fresh run when the manual re-run runs against a failed record", async () => {
    const gateway = fakeGateway({ submit: run("pending") });
    setMemeRunGateway(gateway);

    const store = createStore({ ...runMemeCalliope.mock, memeRun: run("failed", "boom") });
    await createEngine(store).runModule(runMemeCalliope.module, { id: NODE, moduleId: runMemeCalliope.module.id });

    // A terminal failure is the one case that submits on top of an existing record: the backend allows a fresh
    // dispatch then (`MemeRunFinished`), and speaking to the dead run again would only repeat its failure.
    expect(gateway.submitted).toEqual([runMemeCalliope.mock?.modelId]);
    expect(store.data.memeRun).toEqual(run("pending"));
  });

  it("commits nothing when the re-read run is unchanged, but still records the run", async () => {
    const gateway = fakeGateway({ status: run("running") });
    setMemeRunGateway(gateway);

    const store = createStore({ ...runMemeCalliope.mock, memeRun: run("running") });
    await createEngine(store).runModule(runMemeCalliope.module, { id: NODE, moduleId: runMemeCalliope.module.id });

    // One trace, a zero-diff transaction: the run was already there and had not moved.
    expect(store.log).toHaveLength(1);
    expect(store.log[0]?.primary).toHaveLength(0);
  });

  it("reads the port before writing it — a run that moves is rewritten without a clobber", async () => {
    // Two reads: the arrival, which finds nothing started and so submits; then the re-read after the run moved.
    const gateway = fakeGateway({ status: [run("failed"), run("completed")] });
    setMemeRunGateway(gateway);

    const store = createStore({ ...runMemeCalliope.mock });
    const engine = createEngine(store);
    await engine.runModule(runMemeCalliope.module, { id: NODE, moduleId: runMemeCalliope.module.id }); // arrival: submits `pending`

    // The run advances as an ordinary change to the port — what a poll's commit would seal.
    store.applyTransaction([
      { op: "replace", path: "/memeRun", prev: run("pending"), next: run("running") },
    ]);

    // The second run rewrites `memeRun`, which the first left holding a value. A blind write would be rejected
    // as `clobber`; succeeding is the proof that run() read the port first.
    await engine.runModule(runMemeCalliope.module, { id: NODE, moduleId: runMemeCalliope.module.id });
    expect(store.data.memeRun).toEqual(run("completed"));
  });

  it("says so plainly when no host installed a gateway, and names the installer", async () => {
    const { error } = await runInScratch(runMemeCalliope);

    expect(error?.message).toContain("no run gateway");
    expect(error?.message).toContain("setMemeRunGateway");
  });
});

describe("run-meme-calliope's gate", () => {
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

  it("carries the failure's message", () => {
    expect(issuesFor({ memeRun: run("failed", FAILURE) })).toEqual([
      { port: "memeRun", message: `The Calliope run failed: ${FAILURE}` },
    ]);
  });
});
