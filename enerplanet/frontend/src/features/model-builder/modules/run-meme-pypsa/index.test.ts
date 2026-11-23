/**
 * `run-meme-pypsa`'s tests.
 *
 * Two things are asserted, the same two worth asserting about any module: that its **declaration** is
 * consistent (`contractIssues`), and that its **behaviour** is what it claims (through the real engine).
 *
 * The leg arrives through a slot, so every behaviour case installs a fake gateway and asserts what the module
 * *does with the answers*: submits once on arrival, submits nothing when a leg is already recorded, commits the
 * outcome when the leg lands, and reports a failure. It also pins the precondition this node alone has — a
 * **completed** Calliope run, without which the backend refuses the leg. The poll itself is not waited on: the
 * outcome-commit is the very `run()` the poll calls, so the cases drive `run()` directly and no test sleeps.
 *
 * Written failing first.
 */
import { describe, expect, it, beforeEach } from "vitest";
import {
  contractIssues,
  createEngine,
  createStore,
  runInScratch,
  type MemePypsaLeg,
  type MemeRun,
} from "@model-builder/core";
import { changedPorts, stageCascade } from "../../core/invalidator";
import type { DiffOp } from "../../core/diff";
import runMemePypsa, { issuesFor } from "./index";
  it("is invalidated when the model is saved again, so an edited model is run again", () => {
    // The leg describes a Calliope run of the *saved* model, and an edit re-saves under the same id: `saveResult`
    // moves, `modelId` never does. Without this edge a completed leg stood for the rest of the session and the
    // adjusted model the variant flow exists to run could not be powered at all.
    const store = createStore({
      ...runMemePypsa.mock,
      memePypsaLeg: leg("completed"),
      saveResult: { modelId: 7, created: true },
    });
    const primary: DiffOp[] = [
      { op: "replace", path: "saveResult", prev: store.data.saveResult, next: { modelId: 7, created: false } },
    ];

    const cascade = stageCascade({
      changed: changedPorts(primary),
      primary,
      data: store.data,
      modules: [runMemePypsa.module],
    });

    expect(cascade.map((op) => op.path)).toContain("/memePypsaLeg");
  });

import { setMemePypsaLegGateway, type MemePypsaLegGateway } from "./source";

/** The node these cases run as — the module's own id, which is what a host uses in test mode. */
const NODE = runMemePypsa.module.id;

/** A power-flow leg record, for the cases that seed or expect one. */
function leg(status: MemePypsaLeg["status"], error?: string): MemePypsaLeg {
  return { framework: "pypsa", status, ...(error === undefined ? {} : { error }) };
}

/** A Calliope run record — the node's precondition. */
function calliope(status: MemeRun["status"]): MemeRun {
  return { framework: "calliope", status };
}

/** The failure message a leg can carry, named once so the cases speak about the same thing. */
const FAILURE = "meme said no";

/**
 * A gateway that answers from a script and remembers what it was asked. `status` may be a single answer (every
 * read) or a queue (one per read), so a case can drive the leg through several states.
 */
function fakeGateway(answers: { submit?: MemePypsaLeg; status?: MemePypsaLeg | MemePypsaLeg[] } = {}): MemePypsaLegGateway & {
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
      return answers.submit ?? leg("pending");
    },
    async status(modelId) {
      polled.push(modelId);
      return queue.shift() ?? leg("running");
    },
  };
}

beforeEach(() => {
  // Every case starts from no gateway; a case that wants one installs it.
  setMemePypsaLegGateway(null);
});

describe("run-meme-pypsa's declaration", () => {
  it("is consistent with the contract", () => {
    expect(contractIssues(runMemePypsa)).toEqual([]);
  });

  it("declares itself an automatic step — nothing for the user to collect", () => {
    expect(runMemePypsa.module.auto).toBe(true);
  });

  it("requires the saved model and a completed Calliope run, and declares the leg it writes", () => {
    expect(
      runMemePypsa.module.params.filter((param) => param.required === true).map((p) => p.port),
    ).toEqual(["modelId", "memeRun"]);
    expect(runMemePypsa.module.params.map((param) => param.port).sort()).toEqual([
      "memePypsaLeg",
      "memeRun",
      "modelId",
      "saveResult",
    ]);
  });

  it("declares all three edges — a different model, a save, and a different Calliope run", () => {
    // The leg is *derived from* the Calliope run, so a different run makes the leg describe stale results;
    // the backend drops the leg's row when a new Calliope run starts for the same reason.
    expect([...runMemePypsa.module.affect.modelId!]).toEqual(["memePypsaLeg"]);
    expect([...runMemePypsa.module.affect.saveResult!]).toEqual(["memePypsaLeg"]);
    expect([...runMemePypsa.module.affect.memeRun!]).toEqual(["memePypsaLeg"]);
  });

  it("declares the two regions an auto node shows into, and no forward action", () => {
    expect([...runMemePypsa.module.layout].sort()).toEqual(["bottom", "overlay"]);
  });

  it("leaves seal at its default — one record, one writer, one transaction", () => {
    expect(runMemePypsa.module.seal).toBeUndefined();
  });
});

describe("run-meme-pypsa's run", () => {
  it("reads the model first, then submits, when nothing has been started", async () => {
    // The model reports nothing started, which is what one that has never been run looks like through the
    // gateway: a leg status nobody has set lands on `failed`. Without this answer the fake defaults to a leg
    // already going, which is the case below.
    const gateway = fakeGateway({ submit: leg("pending"), status: leg("failed") });
    setMemePypsaLegGateway(gateway);

    const { store, error } = await runInScratch(runMemePypsa);

    expect(error).toBeUndefined();
    expect(gateway.polled).toEqual([runMemePypsa.mock?.modelId]);
    expect(gateway.submitted).toEqual([runMemePypsa.mock?.modelId]);
    expect(store.data.memePypsaLeg).toEqual(leg("pending"));
  });

  it("continues a leg it finds already going instead of starting a second one", async () => {
    // A reopened session restores without the leg's record, so arrival happens again — and the leg may already be
    // running. Submitting from nothing here is what dispatched a duplicate power flow; the read is what tells a
    // session continuing a leg from one starting it.
    const gateway = fakeGateway({ status: leg("running") });
    setMemePypsaLegGateway(gateway);

    const { store, error } = await runInScratch(runMemePypsa);

    expect(error).toBeUndefined();
    expect(gateway.submitted).toEqual([]);
    expect(store.data.memePypsaLeg?.status).toBe("running");
  });

  it("adopts a leg that has already finished, rather than running the model again", async () => {
    const gateway = fakeGateway({ status: leg("completed") });
    setMemePypsaLegGateway(gateway);

    const { store, error } = await runInScratch(runMemePypsa);

    expect(error).toBeUndefined();
    expect(gateway.submitted).toEqual([]);
    expect(store.data.memePypsaLeg?.status).toBe("completed");
  });

  it("submits nothing when the store already holds a leg record", async () => {
    const gateway = fakeGateway({ status: leg("running") });
    setMemePypsaLegGateway(gateway);

    const store = createStore({ ...runMemePypsa.mock, memePypsaLeg: leg("running") });
    await createEngine(store).runModule(runMemePypsa.module, { id: NODE, moduleId: runMemePypsa.module.id });

    // The backend refuses a duplicate live leg and, for the same reason, a second POST would be wrong: an
    // existing record means read, never resubmit.
    expect(gateway.submitted).toEqual([]);
    expect(gateway.polled).toEqual([runMemePypsa.mock?.modelId]);
  });

  it("commits the outcome when the leg has completed, and the gate goes clean", async () => {
    const gateway = fakeGateway({ status: leg("completed") });
    setMemePypsaLegGateway(gateway);

    const store = createStore({ ...runMemePypsa.mock, memePypsaLeg: leg("running") });
    await createEngine(store).runModule(runMemePypsa.module, { id: NODE, moduleId: runMemePypsa.module.id });

    expect(store.data.memePypsaLeg).toEqual(leg("completed"));
    expect(issuesFor(store.data)).toEqual([]);
  });

  it("reports a failed leg, carrying the message", async () => {
    const gateway = fakeGateway({ status: leg("failed", FAILURE) });
    setMemePypsaLegGateway(gateway);

    const store = createStore({ ...runMemePypsa.mock, memePypsaLeg: leg("running") });
    await createEngine(store).runModule(runMemePypsa.module, { id: NODE, moduleId: runMemePypsa.module.id });

    expect(store.data.memePypsaLeg).toEqual(leg("failed", FAILURE));
    const issues = issuesFor(store.data);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.port).toBe("memePypsaLeg");
    expect(issues[0]?.message).toContain(FAILURE);
  });

  it("submits a fresh leg when the manual re-run runs against a failed record", async () => {
    const gateway = fakeGateway({ submit: leg("pending") });
    setMemePypsaLegGateway(gateway);

    const store = createStore({ ...runMemePypsa.mock, memePypsaLeg: leg("failed", "boom") });
    await createEngine(store).runModule(runMemePypsa.module, { id: NODE, moduleId: runMemePypsa.module.id });

    // A terminal failure is the one case that submits on top of an existing record: the backend allows a fresh
    // dispatch once a leg is terminal (`MemeRunFinished`), and re-reading the dead leg would only repeat it.
    expect(gateway.submitted).toEqual([runMemePypsa.mock?.modelId]);
    expect(store.data.memePypsaLeg).toEqual(leg("pending"));
  });

  it("commits nothing when the re-read leg is unchanged, but still records the run", async () => {
    const gateway = fakeGateway({ status: leg("running") });
    setMemePypsaLegGateway(gateway);

    const store = createStore({ ...runMemePypsa.mock, memePypsaLeg: leg("running") });
    await createEngine(store).runModule(runMemePypsa.module, { id: NODE, moduleId: runMemePypsa.module.id });

    // One trace, a zero-diff transaction: the leg was already there and had not moved.
    expect(store.log).toHaveLength(1);
    expect(store.log[0]?.primary).toHaveLength(0);
  });

  it("reads the port before writing it — a leg that moves is rewritten without a clobber", async () => {
    // Two reads: the arrival, which finds nothing started and so submits; then the re-read after the leg moved.
    const gateway = fakeGateway({ status: [leg("failed"), leg("completed")] });
    setMemePypsaLegGateway(gateway);

    const store = createStore({ ...runMemePypsa.mock });
    const engine = createEngine(store);
    await engine.runModule(runMemePypsa.module, { id: NODE, moduleId: runMemePypsa.module.id }); // arrival: submits `pending`

    // The leg advances as an ordinary change to the port — what a poll's commit would seal.
    store.applyTransaction([
      { op: "replace", path: "/memePypsaLeg", prev: leg("pending"), next: leg("running") },
    ]);

    // The second run rewrites `memePypsaLeg`, which the first left holding a value. A blind write would be
    // rejected as `clobber`; succeeding is the proof that run() read the port first.
    await engine.runModule(runMemePypsa.module, { id: NODE, moduleId: runMemePypsa.module.id });
    expect(store.data.memePypsaLeg).toEqual(leg("completed"));
  });

  it("says so plainly when no host installed a gateway, and names the installer", async () => {
    const { error } = await runInScratch(runMemePypsa);

    expect(error?.message).toContain("no run gateway");
    expect(error?.message).toContain("setMemePypsaLegGateway");
  });

  it("refuses to dispatch without a completed Calliope run — and submits nothing", async () => {
    const gateway = fakeGateway();
    setMemePypsaLegGateway(gateway);

    // A merely present run is not enough: the backend derives the leg from a *completed* run's results.
    const store = createStore({ modelId: 1, memeRun: calliope("running") });
    await expect(
      createEngine(store).runModule(runMemePypsa.module, { id: NODE, moduleId: runMemePypsa.module.id }),
    ).rejects.toThrow(/completed Calliope run/);

    expect(gateway.submitted).toEqual([]);
    expect(store.data.memePypsaLeg).toBeUndefined();
  });
});

describe("run-meme-pypsa's gate", () => {
  it("says nothing once the leg completed", () => {
    expect(issuesFor({ memeRun: calliope("completed"), memePypsaLeg: leg("completed") })).toEqual([]);
  });

  it("reports the Calliope precondition before anything else — a present-but-unfinished run is not enough", () => {
    expect(issuesFor({})).toEqual([
      { port: "memeRun", message: "The model's Calliope run has not happened yet." },
    ]);
    expect(issuesFor({ memeRun: calliope("running") })).toEqual([
      { port: "memeRun", message: "The Calliope run is still running." },
    ]);
    expect(issuesFor({ memeRun: calliope("failed") })).toEqual([
      { port: "memeRun", message: "The Calliope run failed: no reason given" },
    ]);
  });

  it("reports a leg that has not happened, or is still going, as unfinished", () => {
    expect(issuesFor({ memeRun: calliope("completed") })).toEqual([
      { port: "memePypsaLeg", message: "The power flow has not been run yet." },
    ]);
    expect(issuesFor({ memeRun: calliope("completed"), memePypsaLeg: leg("pending") })).toEqual([
      { port: "memePypsaLeg", message: "The power flow is still pending." },
    ]);
    expect(issuesFor({ memeRun: calliope("completed"), memePypsaLeg: leg("running") })).toEqual([
      { port: "memePypsaLeg", message: "The power flow is still running." },
    ]);
  });

  it("carries a failed leg's message", () => {
    expect(issuesFor({ memeRun: calliope("completed"), memePypsaLeg: leg("failed", FAILURE) })).toEqual([
      { port: "memePypsaLeg", message: `The power flow failed: ${FAILURE}` },
    ]);
  });
});
