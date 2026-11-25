/**
 * The `example-auto` module — the auto-node template: derive an area summary from the area the user drew.
 *
 * An `auto` node: the frame runs it on arrival and advances by itself. Its job is a derived summary (rings,
 * points, bounding box, centroid) produced through an injected source (`source.ts`). Writes to the namespaced
 * `advancedParams` key `AREA_SUMMARY_KEY`. Regions: `overlay`, `bottom`.
 */

import {
  defineModule,
  type AutoRunState,
  type BuilderModule,
  type ModelData,
  type ModuleViewProps,
  type ValidationIssue,
} from "@model-builder/core";
import { useTranslation } from "@spatialhub/i18n";
import { areaSummarySource, type AreaSummary } from "./source";

/** The module's own surface, re-exported so a host installs a source through the module's entry point. */
export { setAreaSummarySource, areaSummarySource } from "./source";

/** The key this module owns inside the shared `advancedParams` bag. */
export const AREA_SUMMARY_KEY = "example-auto.areaSummary";

/** Two summaries are the same when their values are — the comparison that makes a re-run commit nothing. */
function sameSummary(current: unknown, next: AreaSummary): boolean {
  return JSON.stringify(current) === JSON.stringify(next);
}

/** What this module stands behind: an area has been drawn, so there is something to summarise. */
export function issuesFor(projection: Readonly<ModelData>): ValidationIssue[] {
  const rings = projection.coordinates;
  if (rings === undefined || rings.length === 0) {
    return [{ port: "coordinates", message: "No area has been drawn yet." }];
  }
  return [];
}

const module = defineModule({
  id: "example-auto",
  name: "Example auto module",

  // An automatic step: the summary has nothing for the user to collect, so it runs on arrival (`shell/autoRun.ts`).
  auto: true,

  // The whole store surface, and exactly what `run()` touches. `coordinates` is required; `advancedParams` is where the summary goes.
  params: [{ port: "coordinates", required: true }, { port: "advancedParams" }],

  // A different drawn area invalidates the summary. `affect.advancedParams` is absent: the module reads it only to merge.
  affect: { coordinates: ["advancedParams"] },

  // `overlay` is where an auto node shows its run state; `bottom` is its status strip. No `sidebar`, no forward action.
  layout: ["overlay", "bottom"],

  // `seal` is left at the default, `at-completion`: one derived value, one writer, one natural transaction.

  run: async (ctx) => {
    const rings = ctx.read("coordinates");
    if (rings === undefined) {
      throw new Error("example-auto needs a drawn area before it can summarise one");
    }

    const summary = await areaSummarySource().summarise(rings);

    // Read the bag before writing: the merge (keep another module's keys) and the anti-clobber licence.
    const current = ctx.read("advancedParams") ?? {};
    if (!sameSummary(current[AREA_SUMMARY_KEY], summary)) {
      ctx.commit({ advancedParams: { ...current, [AREA_SUMMARY_KEY]: summary } });
    }
  },

  validate: (ctx) => issuesFor(ctx.store),
});

/** The full-screen state view for an `auto` node — no Continue button; `error` is the one state with a manual re-run. */
const OverlayRegion: React.FC<{ auto?: AutoRunState }> = ({ auto }) => {
  const { t } = useTranslation();
  // Test mode renders no overlay (none is forced open and there is no position), so there is nothing to show.
  if (auto === undefined) return null;

  if (auto.state === "error") {
    return (
      <div className="flex h-full min-h-[12rem] flex-col items-center justify-center gap-3 text-center">
        <p className="text-sm font-medium text-destructive">{t("modelBuilder.example-auto.failed")}</p>
        {auto.message !== undefined && (
          <p className="max-w-md text-xs text-muted-foreground">{auto.message}</p>
        )}
        <button
          type="button"
          onClick={auto.rerun}
          className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted"
        >
          {t("modelBuilder.example-auto.retry")}
        </button>
      </div>
    );
  }

  const done = auto.state === "done";
  return (
    <div className="flex h-full min-h-[12rem] flex-col items-center justify-center gap-2 text-center">
      <p
        className={`text-sm font-medium ${
          done ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"
        }`}
      >
        {done ? t("modelBuilder.example-auto.done") : t("modelBuilder.example-auto.running")}
      </p>
      {!done && (
        <p className="text-xs text-muted-foreground">{t("modelBuilder.example-auto.runningHint")}</p>
      )}
    </div>
  );
};

const Component: React.FC<ModuleViewProps> = ({ region, data, auto, nodeId }) => {
  const { t } = useTranslation();

  if (region === "overlay") return <OverlayRegion auto={auto} />;

  // ── bottom: the status strip. Intrinsic height; says the node id and whether the store holds this module's summary.
  if (region === "bottom") {
    const present = data.advancedParams?.[AREA_SUMMARY_KEY] !== undefined;
    return (
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <span className="font-medium">{nodeId}</span>
        <span className="flex items-baseline gap-1.5">
          <span className="font-mono text-xs text-muted-foreground">advancedParams</span>
          {present ? (
            <span className="text-foreground">{t("modelBuilder.example-auto.bottom.present")}</span>
          ) : (
            <span className="text-amber-600 dark:text-amber-400">
              {t("modelBuilder.example-auto.bottom.notSet")}
            </span>
          )}
        </span>
      </div>
    );
  }

  return null;
};

const builderModule: BuilderModule = {
  module,
  Component,
  // The test data: the smallest inputs the module needs — a couple of small rings to summarise.
  mock: {
    coordinates: [
      [
        [8.5, 49.3],
        [8.6, 49.3],
        [8.6, 49.4],
      ],
      [
        [8.7, 49.3],
        [8.8, 49.3],
        [8.8, 49.4],
        [8.7, 49.4],
      ],
    ],
  },
};

export default builderModule;
