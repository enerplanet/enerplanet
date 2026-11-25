/**
 * The `run-meme-calliope` module — dispatch the model to a MEME/Calliope run and resume on it.
 *
 * An `auto` node: the frame runs it on arrival, advancing by itself once the run lands. Declares `overlay`
 * (run state) and `bottom` (status strip). Requires `modelId` from `model-save`; commits the run record
 * (`memeRun`). The gateway is injected at startup (`source.ts`).
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

/** The module's own surface, re-exported so a host installs a gateway through the module's entry point. */
export { setMemeRunGateway, type MemeRunGateway } from "./source";

/** How long the poll waits between reads of an in-flight run (a run lasts minutes). */
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

/** What this module stands behind: a run that reached `completed`. */
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

  // `modelId` is required (backend refuses a run unless the model is saved and complete); `saveResult` re-runs an edited model.
  params: [
    { port: "modelId", required: true },
    { port: "saveResult" },
    { port: "memeRun" },
  ],

  // Two edges, both needed: `modelId` moves when the model is created, `saveResult` every time it is saved.
  affect: { modelId: ["memeRun"], saveResult: ["memeRun"] },

  // `overlay` is where an auto node shows its run state; `bottom` is its status strip. No `sidebar`, no forward action.
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

    // No run recorded on this session: ask the model what it is doing before submitting, so reopening a finished model does not dispatch a second run.
    if (existing === undefined) {
      const current = await gateway.status(modelId);
      const alreadyStarted =
        current.status === "pending" || current.status === "running" || current.status === "completed";
      ctx.commit({ memeRun: alreadyStarted ? current : await gateway.submit(modelId) });
      return;
    }

    // A completed run is the node's finished work; nothing pressing on would change.
    if (existing.status === "completed") return;

    // A failed run is the manual re-run's target: the backend allows a fresh dispatch once a run is terminal.
    if (existing.status === "failed") {
      ctx.commit({ memeRun: await gateway.submit(modelId) });
      return;
    }

    // A run still in flight: read it and commit only if it moved — both the poll's commit and an arrival that finds one going.
    const latest = await gateway.status(modelId);
    if (sameRun(existing, latest)) return;
    ctx.commit({ memeRun: latest });
  },

  validate: (ctx) => issuesFor(ctx.store),
});

/** Follow an in-flight run and hand the outcome to `run()` the moment it lands; only the overlay instance polls. */
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

    // Ask once on mount — reopening the editor lands here after the run may already have finished — then on the interval.
    void tick();
    const timer = setInterval(() => void tick(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [status, modelId]);
}

/** The full-screen state view for an `auto` node — no control while in progress, message + manual re-run on failure. */
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

  // ── bottom: the status strip. Intrinsic height; names the node and where its run stands.
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
  // The test data: the input the node cannot run without — a saved model.
  mock: {
    modelId: 1,
  },
};

export default builderModule;
