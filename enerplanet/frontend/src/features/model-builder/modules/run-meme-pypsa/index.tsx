/**
 * The `run-meme-pypsa` module — dispatch the model's isolated PyPSA power-flow leg and resume on it.
 *
 * An `auto` node: the frame runs it on arrival, advancing by itself once the leg lands. Declares `overlay`
 * (leg state) and `bottom` (status strip). It requires a completed Calliope run (`memeRun`) beside `modelId`,
 * and commits the leg's record (`memePypsaLeg`). The gateway is injected at startup (`source.ts`).
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

/** The module's own surface, re-exported so a host installs a gateway through the module's entry point. */
export { setMemePypsaLegGateway, type MemePypsaLegGateway } from "./source";

/** How long the poll waits between reads of an in-flight leg (a power flow lasts minutes). */
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

/** The message for a Calliope run that is not yet the precondition this node needs. */
function calliopePrecondition(run: ModelData["memeRun"]): string {
  if (run === undefined) return "The model's Calliope run has not happened yet.";
  if (run.status === "failed") return `The Calliope run failed: ${run.error ?? "no reason given"}`;
  return `The Calliope run is still ${run.status}.`;
}

/** What this module stands behind: a power-flow leg that reached `completed`, after a completed Calliope run. */
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

  // `modelId` and `memeRun` are both required — the backend refuses the leg without a saved, complete model and a completed Calliope run.
  params: [
    { port: "modelId", required: true },
    { port: "saveResult" },
    { port: "memeRun", required: true },
    { port: "memePypsaLeg" },
  ],

  // Two edges, both honest: a different saved model, or a different Calliope run, invalidates the leg.
  affect: { modelId: ["memePypsaLeg"], saveResult: ["memePypsaLeg"], memeRun: ["memePypsaLeg"] },

  // `overlay` is where an auto node shows its leg state; `bottom` is its status strip. No `sidebar`, no forward action.
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

    // The precondition, checked here too: the backend refuses the leg without a completed Calliope run.
    const calliope = ctx.read("memeRun");
    if (calliope === undefined || calliope.status !== "completed") {
      throw new Error(
        "run-meme-pypsa needs a completed Calliope run first: the backend refuses the power-flow leg without one",
      );
    }

    const existing = ctx.read("memePypsaLeg");

    // No leg recorded on this session: ask the model what it is doing before submitting, so reopening a finished model does not dispatch a second leg.
    if (existing === undefined) {
      const current = await gateway.status(modelId);
      const alreadyStarted =
        current.status === "pending" || current.status === "running" || current.status === "completed";
      ctx.commit({ memePypsaLeg: alreadyStarted ? current : await gateway.submit(modelId) });
      return;
    }

    // A completed leg is the node's finished work; nothing pressing on would change.
    if (existing.status === "completed") return;

    // A failed leg is the manual re-run's target: the backend allows a fresh dispatch once a leg is terminal.
    if (existing.status === "failed") {
      ctx.commit({ memePypsaLeg: await gateway.submit(modelId) });
      return;
    }

    // A leg still in flight: read it and commit only if it moved — both the poll's commit and an arrival that finds one going.
    const latest = await gateway.status(modelId);
    if (sameLeg(existing, latest)) return;
    ctx.commit({ memePypsaLeg: latest });
  },

  validate: (ctx) => issuesFor(ctx.store),
});

/** Follow an in-flight leg and hand the outcome to `run()` the moment it lands; only the overlay instance polls. */
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

    // Ask once on mount — reopening the editor lands here after the leg may already have finished — then on the interval.
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

  // ── bottom: the status strip. Intrinsic height; names the node and where its leg stands.
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
  // The test data: the inputs the node cannot run without — a saved model and a completed Calliope run.
  mock: {
    modelId: 1,
    memeRun: { framework: "calliope", status: "completed" },
  },
};

export default builderModule;
