/**
 * The `run-meme-pypsa` module — dispatch the model's isolated PyPSA power-flow leg and resume on it.
 *
 * **What an auto node is.** A step the user never starts. There is no button and no forward action anywhere on
 * it: the frame runs it **on arrival**, once its inputs are present, and advances by itself once the leg lands
 * (`shell/autoRun.ts`). Its only UI is the leg's **state** — in progress, done, or failed with a manual re-run —
 * which is why it declares `overlay` and `bottom` and nothing else.
 *
 * **Why this node exists.** The power flow is a *derived* run: the backend builds a MEME `meme-pypsa` job from
 * the parsed **Calliope** results, so a model with no completed Calliope leg is refused (`CalliopeLegReady`, a
 * 400 at request time). That is the one precondition this node has that `run-meme-calliope` does not, and it is
 * expressed by declaring **`memeRun` required** beside `modelId`: the run must have happened *and* finished
 * first, and the flow — not this file — is what orders the two nodes. It dispatches through an injected gateway
 * (`source.ts`) that a host installs at startup; the module knows nothing of the app's HTTP client, and there is
 * no default, because a fabricated leg would be a lie about the backend.
 *
 * **What it commits, and why that is a port.** The leg's record — `memePypsaLeg` in `core/ports.ts` — says where
 * the leg stands, not what it produced; the power-flow results are read by the nodes that consume them. It is a
 * core port because the ordering is exactly this dependency: the power-flow results node declares `memePypsaLeg`
 * required, which places it *after* this node by construction. Unlike the Calliope run's record, the backend
 * exposes this leg's status **directly** (`pypsa_leg_status`); the host needs no model-lifecycle mapping.
 *
 * **The leg outlives the page.** A power flow takes minutes, so the user can leave and come back — the UI says
 * so. A `validate()` that reports an unfinished leg keeps the session resting on this node
 * (`core/position.ts`), so reopening lands here, and the module then polls and commits the outcome when the leg
 * reaches a terminal state — at which point the frontier advances on its own.
 *
 * `seal` is left at the default, `at-completion`: the leg's writes are one record, committed once per leg, and
 * there is no second writer to interleave with.
 */

import { useEffect, useRef } from "react";
import {
  defineModule,
  type AutoRunState,
  type BuilderModule,
  type MemePypsaLeg,
  type ModelData,
  type ModuleViewProps,
  type ValidationIssue,
} from "@model-builder/core";
import { useTranslation } from "@spatialhub/i18n";
import { memePypsaLegGateway } from "./source";

/**
 * The module's own surface, re-exported: a host installs a gateway through the same entry point it imports the
 * module from, so it never reaches into the module's files. Same shape as `setMemeRunGateway`.
 */
export { setMemePypsaLegGateway, type MemePypsaLegGateway } from "./source";

/**
 * How long the poll waits between reads of an in-flight leg. A power flow lasts minutes, so a few seconds of
 * latency in noticing the end is immaterial; the interval only has to be far shorter than the leg. Tests do not
 * wait on it: they drive `run()` directly, which is the very call the poll makes when the leg lands.
 */
const POLL_INTERVAL_MS = 5000;

/** Two leg records are the same when their values are — the comparison that makes a re-read commit nothing. */
function sameLeg(current: MemePypsaLeg | undefined, next: MemePypsaLeg): boolean {
  return (
    current !== undefined &&
    current.framework === next.framework &&
    current.status === next.status &&
    current.runId === next.runId &&
    current.error === next.error
  );
}

/**
 * The message for a Calliope run that is not yet the precondition this node needs.
 *
 * The backend gates the power-flow leg on a **completed** Calliope run, so a merely present `memeRun` is not
 * enough: the leg is derived from that run's results, and there are none until it finishes. Reported against
 * `memeRun` because that port is the precondition, and only when the run has not completed.
 */
function calliopePrecondition(run: ModelData["memeRun"]): string {
  if (run === undefined) return "The model's Calliope run has not happened yet.";
  if (run.status === "failed") return `The Calliope run failed: ${run.error ?? "no reason given"}`;
  return `The Calliope run is still ${run.status}.`;
}

/**
 * What this module stands behind: a power-flow leg that reached `completed`.
 *
 * The **first** thing judged is the calliope precondition — a completed run — because nothing else can be
 * decided without it: the leg is derived from that run, and until it finishes there is nothing to judge. Then
 * an absent leg, or one still `pending`/`running`, is unfinished, so the session rests on this node and the
 * frontier does not advance. A `failed` leg is reported with its message, which is what the node shows in its
 * error state beside the one affordance an auto node has, the manual re-run. The status strings are the
 * backend's own.
 */
export function issuesFor(projection: Readonly<ModelData>): ValidationIssue[] {
  const run = projection.memeRun;
  if (run?.status !== "completed") {
    return [{ port: "memeRun", message: calliopePrecondition(run) }];
  }

  const leg = projection.memePypsaLeg;
  if (leg === undefined) {
    return [{ port: "memePypsaLeg", message: "The power flow has not been run yet." }];
  }
  if (leg.status === "completed") return [];
  if (leg.status === "failed") {
    return [
      { port: "memePypsaLeg", message: `The power flow failed: ${leg.error ?? "no reason given"}` },
    ];
  }
  return [{ port: "memePypsaLeg", message: `The power flow is still ${leg.status}.` }];
}

const module = defineModule({
  id: "run-meme-pypsa",
  name: "Run model (PyPSA)",

  // An automatic step: the leg has nothing for the user to collect, so the frame runs it on arrival (`shell/autoRun.ts`).
  auto: true,

  // `modelId` and `memeRun` are both required — the backend refuses the leg without a saved, complete model
  // *and* a completed Calliope run, and the run node upstream is what produces the latter. `memePypsaLeg` is
  // what this node writes.
  params: [
    { port: "modelId", required: true },
    { port: "memeRun", required: true },
    { port: "memePypsaLeg" },
  ],

  // Two edges, both honest: a different saved model is a different power flow, and — because the leg is
  // *derived from the Calliope run* — a different `memeRun` invalidates the leg too (the backend drops the
  // leg's row when a new Calliope run starts, so the old leg no longer describes this model's results).
  affect: { modelId: ["memePypsaLeg"], memeRun: ["memePypsaLeg"] },

  // `overlay` is where an auto node shows its leg state; `bottom` is its status strip. No `sidebar`, and no
  // forward action — an auto node never has a Continue button.
  layout: ["overlay", "bottom"],

  // `seal` is left at the default, `at-completion`: one record, one writer, one natural transaction.

  run: async (ctx) => {
    const gateway = memePypsaLegGateway();
    if (gateway === null) {
      throw new Error(
        "run-meme-pypsa has no run gateway: a host installs one with setMemePypsaLegGateway() (shell/memePypsaLegGateway.ts)",
      );
    }

    const modelId = ctx.read("modelId");
    if (modelId === undefined) {
      throw new Error("run-meme-pypsa needs a saved model (modelId) before it can run a power flow");
    }

    // The precondition, checked here and not only in `validate()`: the backend refuses the leg without a
    // completed Calliope run, so dispatching would be a request certain to 400. Reading `memeRun` (it is
    // required, so this is a present value) keeps the refusal to the one case that is not a dispatch.
    const calliope = ctx.read("memeRun");
    if (calliope === undefined || calliope.status !== "completed") {
      throw new Error(
        "run-meme-pypsa needs a completed Calliope run first: the backend refuses the power-flow leg without one",
      );
    }

    const existing = ctx.read("memePypsaLeg");

    // No leg recorded on *this* session. That is the first pass through a flow, where there is genuinely
    // nothing to read — and it is also a reopened session, because a run's record is not part of what a session
    // restores. So "no record" cannot mean "submit": ask the model what it is doing first. A leg already
    // pending, running or completed is one this session continues rather than starts, and submitting from
    // nothing on one of those is what made reopening a finished model dispatch a second power flow.
    if (existing === undefined) {
      const current = await gateway.status(modelId);
      const alreadyStarted =
        current.status === "pending" || current.status === "running" || current.status === "completed";
      ctx.commit({ memePypsaLeg: alreadyStarted ? current : await gateway.submit(modelId) });
      return;
    }

    // A completed leg is the node's finished work; nothing pressing on would change.
    if (existing.status === "completed") return;

    // A failed leg is the manual re-run's target. The backend allows a fresh dispatch once a leg is terminal
    // (`MemeRunFinished`), and re-reading a dead leg would only repeat its failure — so this is the one case
    // that submits on top of an existing record. The record's status being terminal-and-failed is what makes a
    // second POST right here rather than the duplicate the arrival run must never make.
    if (existing.status === "failed") {
      ctx.commit({ memePypsaLeg: await gateway.submit(modelId) });
      return;
    }

    // A leg still in flight: read it and commit only if it moved. This is both the poll's outcome-commit and an
    // arrival that finds a leg already going — on arrival the answer is the same record, so nothing is committed
    // and no second leg is submitted.
    const latest = await gateway.status(modelId);
    if (sameLeg(existing, latest)) return;
    ctx.commit({ memePypsaLeg: latest });
  },

  validate: (ctx) => issuesFor(ctx.store),
});

/**
 * Follow an in-flight leg and hand the outcome to `run()` the moment it lands (`ModuleViewProps.run`).
 *
 * Only the overlay instance polls — the module's `Component` renders once per declared region, and the leg's
 * state is what the overlay shows. The leg's status is read off the leg's own field (`pypsa_leg_status`), so
 * the poll is a plain status read; a failed read is not the leg failing, and the next tick asks again. The
 * callback is held in a ref so the host's `run` identity (which changes every render) is not a reason to
 * restart the interval.
 */
function useLegOutcome(
  record: MemePypsaLeg | undefined,
  modelId: number | undefined,
  runModule: () => Promise<void>,
): void {
  const status = record?.status;
  const runRef = useRef(runModule);
  runRef.current = runModule;

  useEffect(() => {
    if (modelId === undefined) return undefined;
    if (status !== "pending" && status !== "running") return undefined;

    let cancelled = false;
    const tick = async (): Promise<void> => {
      const gateway = memePypsaLegGateway();
      if (gateway === null) return;
      let latest: MemePypsaLeg;
      try {
        latest = await gateway.status(modelId);
      } catch {
        return;
      }
      if (cancelled) return;
      if (latest.status === "completed" || latest.status === "failed") await runRef.current();
    };

    // Ask once on mount — reopening the editor lands here after the leg may already have finished — then on the
    // interval.
    void tick();
    const timer = setInterval(() => void tick(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [status, modelId]);
}

/**
 * The **full-screen state view** for an `auto` node — the only thing an auto node shows (`autoRun.ts`).
 *
 * The structure is `run-meme-calliope`'s: no control at all while the leg is in progress or done, and on
 * failure the message plus the **manual re-run**. The state itself is read from the port, not from
 * `auto.state`: the frame's `auto.state` describes its own `run()` call, which returns as soon as the leg is
 * dispatched, while this node's actual progress lives in `memePypsaLeg`. `auto` supplies the test-mode guard
 * and the one control.
 */
const OverlayRegion: React.FC<{
  auto?: AutoRunState;
  data: Readonly<ModelData>;
  run: () => Promise<void>;
}> = ({ auto, data, run }) => {
  const { t } = useTranslation();
  useLegOutcome(data.memePypsaLeg, data.modelId, run);

  // Test mode renders no overlay (none is forced open and there is no position), so there is nothing to show.
  if (auto === undefined) return null;

  const record = data.memePypsaLeg;
  const failed = record?.status === "failed" || auto.state === "error";
  const done = record?.status === "completed";

  if (failed) {
    const message = record?.error ?? auto.message;
    return (
      <div className="flex h-full min-h-[12rem] flex-col items-center justify-center gap-3 text-center">
        <p className="text-sm font-medium text-destructive">
          {t("modelBuilder.run-meme-pypsa.failed")}
        </p>
        {message !== undefined && (
          <p className="max-w-md text-xs text-muted-foreground">{message}</p>
        )}
        <button
          type="button"
          onClick={auto.rerun}
          className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted"
        >
          {t("modelBuilder.run-meme-pypsa.retry")}
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-[12rem] flex-col items-center justify-center gap-2 text-center">
      <p
        className={`text-sm font-medium ${
          done ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"
        }`}
      >
        {done ? t("modelBuilder.run-meme-pypsa.done") : t("modelBuilder.run-meme-pypsa.running")}
      </p>
      {!done && (
        <p className="max-w-md text-xs text-muted-foreground">
          {t("modelBuilder.run-meme-pypsa.runningHint")}
        </p>
      )}
    </div>
  );
};

const Component: React.FC<ModuleViewProps> = ({ region, data, auto, run, nodeId }) => {
  const { t } = useTranslation();

  if (region === "overlay") return <OverlayRegion auto={auto} data={data} run={run} />;

  // ── bottom: the status strip. Intrinsic height on purpose — its box is a cap, so a strip that fits renders
  //    as a strip. It names the node and where its leg stands, by colour and word.
  if (region === "bottom") {
    const record = data.memePypsaLeg;
    const status =
      record === undefined ? (
        <span className="text-amber-600 dark:text-amber-400">
          {t("modelBuilder.run-meme-pypsa.bottom.notRun")}
        </span>
      ) : record.status === "completed" ? (
        <span className="text-emerald-600 dark:text-emerald-400">
          {t("modelBuilder.run-meme-pypsa.bottom.completed")}
        </span>
      ) : record.status === "failed" ? (
        <span className="text-destructive">
          {t("modelBuilder.run-meme-pypsa.bottom.failed")}
        </span>
      ) : (
        <span className="text-muted-foreground">
          {t("modelBuilder.run-meme-pypsa.bottom.running")}
        </span>
      );

    return (
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <span className="font-medium">{nodeId}</span>
        <span className="flex items-baseline gap-1.5">
          <span className="font-mono text-xs text-muted-foreground">memePypsaLeg</span>
          {status}
        </span>
      </div>
    );
  }

  return null;
};

const builderModule: BuilderModule = {
  module,
  Component,
  // The test data: the inputs the node cannot run without — a saved model *and* a completed Calliope run, which
  // the backend requires before it will derive the leg. The gateway is not mocked here (the module has no
  // default); a test installs a fake through `setMemePypsaLegGateway`.
  mock: {
    modelId: 1,
    memeRun: { framework: "calliope", status: "completed" },
  },
};

export default builderModule;
