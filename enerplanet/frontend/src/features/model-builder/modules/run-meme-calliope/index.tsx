/**
 * The `run-meme-calliope` module — dispatch the model to a MEME/Calliope run and resume on it.
 *
 * **What an auto node is.** A step the user never starts. There is no button and no forward action anywhere on
 * it: the frame runs it **on arrival**, once its inputs are present, and advances by itself once the run lands
 * (`shell/autoRun.ts`). Its only UI is the run's **state** — in progress, done, or failed with a manual re-run —
 * which is why it declares `overlay` and `bottom` and nothing else.
 *
 * **Why this node exists.** A MEME run is the model's calculation, not a fetch: it goes to TentaCron, which
 * polls MEME to completion for up to ~45 minutes. The run is refused unless the model is saved and complete
 * ("model is incomplete: finish building it before running it"), so this node depends on `model-save` for
 * `modelId` — really, not incidentally. It dispatches through an injected gateway (`source.ts`) that a host
 * installs at startup; the module knows nothing of the app's HTTP client, and there is no default, because a
 * fabricated run would be a lie about the backend.
 *
 * **What it commits, and why that is a port.** The run's record — `memeRun` in `core/ports.ts` — says where the
 * run stands, not what it produced; the results are read by the nodes that consume them. It is a first-class
 * port rather than a bag entry because the ordering the flow rests on is exactly this dependency:
 * `run-meme-pypsa`, the results overview and the compare node all declare `memeRun` required, which is what
 * places them *after* this node by construction. Adding the port was a core change.
 *
 * **The run outlives the page.** A run takes minutes, so the user can leave and come back — the UI says so. A
 * `validate()` that reports an unfinished run keeps the session resting on this node (`core/position.ts`), so
 * reopening lands here, and the module then polls and commits the outcome when the run reaches a terminal
 * state — at which point the frontier advances on its own.
 *
 * `seal` is left at the default, `at-completion`: the run's writes are one record, committed once per run, and
 * there is no second writer to interleave with.
 */

import { useEffect, useRef } from "react";
import {
  defineModule,
  type AutoRunState,
  type BuilderModule,
  type MemeRun,
  type ModelData,
  type ModuleViewProps,
  type ValidationIssue,
} from "@model-builder/core";
import { useTranslation } from "@spatialhub/i18n";
import { memeRunGateway } from "./source";

/**
 * The module's own surface, re-exported: a host installs a gateway through the same entry point it imports the
 * module from, so it never reaches into the module's files. Same shape as `setDemandSource`.
 */
export { setMemeRunGateway, type MemeRunGateway } from "./source";

/**
 * How long the poll waits between reads of an in-flight run. A run lasts minutes, so a few seconds of latency in
 * noticing the end is immaterial; the interval only has to be far shorter than the run. Tests do not wait on it:
 * they drive `run()` directly, which is the very call the poll makes when the run lands.
 */
const POLL_INTERVAL_MS = 5000;

/** Two run records are the same when their values are — the comparison that makes a re-read commit nothing. */
function sameRun(current: MemeRun | undefined, next: MemeRun): boolean {
  return (
    current !== undefined &&
    current.framework === next.framework &&
    current.status === next.status &&
    current.runId === next.runId &&
    current.error === next.error
  );
}

/**
 * What this module stands behind: a run that reached `completed`.
 *
 * An absent run, or one still `pending`/`running`, is unfinished — the node is not done, so the session rests on
 * it and the frontier does not advance. A `failed` run is reported with its own message, which is what the node
 * shows in its error state beside the one affordance an auto node has, the manual re-run. The status strings are
 * the backend's own.
 */
export function issuesFor(projection: Readonly<ModelData>): ValidationIssue[] {
  const run = projection.memeRun;
  if (run === undefined) {
    return [{ port: "memeRun", message: "The model has not been run yet." }];
  }
  if (run.status === "completed") return [];
  if (run.status === "failed") {
    return [
      { port: "memeRun", message: `The Calliope run failed: ${run.error ?? "no reason given"}` },
    ];
  }
  return [{ port: "memeRun", message: `The Calliope run is still ${run.status}.` }];
}

const module = defineModule({
  id: "run-meme-calliope",
  name: "Run model (Calliope)",

  // An automatic step: the run has nothing for the user to collect, so the frame runs it on arrival (`shell/autoRun.ts`).
  auto: true,

  // `modelId` is required — the backend refuses a run unless the model is saved and complete, and `model-save`
  // is what produces the id. `memeRun` is what this node writes.
  params: [
    { port: "modelId", required: true },
    { port: "memeRun" },
  ],

  // The one edge: a different saved model is a different run, so this record is invalidated with it.
  affect: { modelId: ["memeRun"] },

  // `overlay` is where an auto node shows its run state; `bottom` is its status strip. No `sidebar`, and no
  // forward action — an auto node never has a Continue button.
  layout: ["overlay", "bottom"],

  // `seal` is left at the default, `at-completion`: one record, one writer, one natural transaction.

  run: async (ctx) => {
    const gateway = memeRunGateway();
    if (gateway === null) {
      throw new Error(
        "run-meme-calliope has no run gateway: a host installs one with setMemeRunGateway() (shell/memeRunGateway.ts)",
      );
    }

    const modelId = ctx.read("modelId");
    if (modelId === undefined) {
      throw new Error("run-meme-calliope needs a saved model (modelId) before it can run one");
    }

    const existing = ctx.read("memeRun");

    // No run recorded on *this* session. That is the first pass through a flow, where there is genuinely
    // nothing to read — and it is also a reopened session, because a run's record is not part of what a session
    // restores. So "no record" cannot mean "submit": ask the model what it is doing first. One already queued,
    // running or completed is a run this session continues rather than starts, and submitting from nothing on
    // one of those is what made reopening a finished model dispatch a second calculation.
    if (existing === undefined) {
      const current = await gateway.status(modelId);
      const alreadyStarted =
        current.status === "pending" || current.status === "running" || current.status === "completed";
      ctx.commit({ memeRun: alreadyStarted ? current : await gateway.submit(modelId) });
      return;
    }

    // A completed run is the node's finished work; nothing pressing on would change.
    if (existing.status === "completed") return;

    // A failed run is the manual re-run's target. The backend allows a fresh dispatch once a run is terminal
    // (`MemeRunFinished`), and re-reading a dead run would only repeat its failure — so this is the one case
    // that submits on top of an existing record. The record's status being terminal-and-failed is what makes a
    // second POST right here rather than the duplicate the arrival run must never make.
    if (existing.status === "failed") {
      ctx.commit({ memeRun: await gateway.submit(modelId) });
      return;
    }

    // A run still in flight: read it and commit only if it moved. This is both the poll's outcome-commit and an
    // arrival that finds a run already going — on arrival the answer is the same record, so nothing is committed
    // and no second run is submitted.
    const latest = await gateway.status(modelId);
    if (sameRun(existing, latest)) return;
    ctx.commit({ memeRun: latest });
  },

  validate: (ctx) => issuesFor(ctx.store),
});

/**
 * Follow an in-flight run and hand the outcome to `run()` the moment it lands (`ModuleViewProps.run`).
 *
 * Only the overlay instance polls — the module's `Component` renders once per declared region, and the run's
 * state is what the overlay shows. The run is read from the model, not a run-specific endpoint, so the poll is
 * a plain status read; a failed read is not the run failing, and the next tick asks again. The callback is held
 * in a ref so the host's `run` identity (which changes every render) is not a reason to restart the interval.
 */
function useRunOutcome(
  record: MemeRun | undefined,
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
      const gateway = memeRunGateway();
      if (gateway === null) return;
      let latest: MemeRun;
      try {
        latest = await gateway.status(modelId);
      } catch {
        return;
      }
      if (cancelled) return;
      if (latest.status === "completed" || latest.status === "failed") await runRef.current();
    };

    // Ask once on mount — reopening the editor lands here after the run may already have finished — then on the
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
 * The structure is `building-demand`'s: no control at all while the run is in progress or done, and on failure
 * the message plus the **manual re-run**. The state itself is read from the port, not from `auto.state`: the
 * frame's `auto.state` describes its own `run()` call, which returns as soon as the run is dispatched, while
 * this node's actual progress lives in `memeRun`. `auto` supplies the test-mode guard and the one control.
 */
const OverlayRegion: React.FC<{
  auto?: AutoRunState;
  data: Readonly<ModelData>;
  run: () => Promise<void>;
}> = ({ auto, data, run }) => {
  const { t } = useTranslation();
  useRunOutcome(data.memeRun, data.modelId, run);

  // Test mode renders no overlay (none is forced open and there is no position), so there is nothing to show.
  if (auto === undefined) return null;

  const record = data.memeRun;
  const failed = record?.status === "failed" || auto.state === "error";
  const done = record?.status === "completed";

  if (failed) {
    const message = record?.error ?? auto.message;
    return (
      <div className="flex h-full min-h-[12rem] flex-col items-center justify-center gap-3 text-center">
        <p className="text-sm font-medium text-destructive">
          {t("modelBuilder.run-meme-calliope.failed")}
        </p>
        {message !== undefined && (
          <p className="max-w-md text-xs text-muted-foreground">{message}</p>
        )}
        <button
          type="button"
          onClick={auto.rerun}
          className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted"
        >
          {t("modelBuilder.run-meme-calliope.retry")}
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
        {done ? t("modelBuilder.run-meme-calliope.done") : t("modelBuilder.run-meme-calliope.running")}
      </p>
      {!done && (
        <p className="max-w-md text-xs text-muted-foreground">
          {t("modelBuilder.run-meme-calliope.runningHint")}
        </p>
      )}
    </div>
  );
};

const Component: React.FC<ModuleViewProps> = ({ region, data, auto, run, nodeId }) => {
  const { t } = useTranslation();

  if (region === "overlay") return <OverlayRegion auto={auto} data={data} run={run} />;

  // ── bottom: the status strip. Intrinsic height on purpose — its box is a cap, so a strip that fits renders
  //    as a strip. It names the node and where its run stands, by colour and word.
  if (region === "bottom") {
    const record = data.memeRun;
    const status =
      record === undefined ? (
        <span className="text-amber-600 dark:text-amber-400">
          {t("modelBuilder.run-meme-calliope.bottom.notRun")}
        </span>
      ) : record.status === "completed" ? (
        <span className="text-emerald-600 dark:text-emerald-400">
          {t("modelBuilder.run-meme-calliope.bottom.completed")}
        </span>
      ) : record.status === "failed" ? (
        <span className="text-destructive">
          {t("modelBuilder.run-meme-calliope.bottom.failed")}
        </span>
      ) : (
        <span className="text-muted-foreground">
          {t("modelBuilder.run-meme-calliope.bottom.running")}
        </span>
      );

    return (
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <span className="font-medium">{nodeId}</span>
        <span className="flex items-baseline gap-1.5">
          <span className="font-mono text-xs text-muted-foreground">memeRun</span>
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
  // The test data: the input the node cannot run without — a saved model. The gateway is not mocked here (the
  // module has no default); a test installs a fake through `setMemeRunGateway`.
  mock: {
    modelId: 1,
  },
};

export default builderModule;
