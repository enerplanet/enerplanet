/**
 * The `example-auto` module — the auto-node template: derive an area summary from the area the user drew.
 *
 * **What an auto node is.** A step the user never starts. There is no button and no forward action anywhere
 * on it: the frame runs it **on arrival**, as soon as its inputs are present, and advances by itself once the
 * run lands (`shell/autoRun.ts`). Its only UI is the run's **state** — in progress, done, or failed with a
 * manual re-run — which is why it declares `overlay` and renders nothing else.
 *
 * **The module declares `auto: true`.** Whether a step runs itself is a fact about its work, so it belongs to
 * the module — the same kind of declaration `seal` is, and for the same reason: only the module knows whether
 * there is anything for the user to collect. A drawn-area summary has nothing to collect, so the frame runs it
 * on arrival and puts no forward action on it, and the module behaves the same wherever it is placed. (This
 * was once a property of the flow's node (`spec/core.md` §286), and that was reversed: nothing in the product
 * could *author* it — the workflow editor has no control for it and the stored document is JSON in a `jsonb`
 * column — while the module already owns its other execution property.)
 *
 * **The job.** Turn the drawn area into a small, obviously derived summary — how many rings, how many points,
 * the bounding box and the centroid. It is the archetypal auto job: work nobody initiates, with nothing for
 * the user to collect. The summary is produced through an injected source (`source.ts`), so the module owns
 * the *decision* to summarise and the host owns *how*.
 *
 * **Where the summary is written, and why.** A module may only write ports the core declares (`core/ports.ts`),
 * so a value that deserves a first-class port means adding it to `ModelData` — a core change. Until then a
 * module carries its own values in the store's free-form `advancedParams` bag, under a key it namespaces to
 * itself. That is what this module does, at `example-auto.areaSummary`. The bag is not a permanent home and
 * not a private one — it is shared — which is exactly why the key is namespaced.
 *
 * **Merge, don't replace.** `run()` reads `advancedParams` first and spreads it, so it adds only its own key
 * and leaves whatever another module put there — the licensed-rewrite discipline `building-demand` uses on
 * `buildingParams`. Reading the port before writing it is mandatory: the engine refuses a blind overwrite as
 * `clobber`.
 *
 * `seal` is left at its default, `at-completion`: the run writes one derived value, and there is no second
 * writer to interleave with, so the whole run is the natural transaction.
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

/**
 * The module's own surface, re-exported: a host installs a source through the same entry point it imports the
 * module from, so it never reaches into the module's files. Same shape as `setDemandSource`.
 */
export { setAreaSummarySource, areaSummarySource } from "./source";

/**
 * The key this module owns inside `advancedParams`. Namespaced because the bag is shared: the port is the
 * core's, the key is ours.
 */
export const AREA_SUMMARY_KEY = "example-auto.areaSummary";

/** Two summaries are the same when their values are — the comparison that makes a re-run commit nothing. */
function sameSummary(current: unknown, next: AreaSummary): boolean {
  return JSON.stringify(current) === JSON.stringify(next);
}

/**
 * What this module stands behind: an area has been drawn, so there is something to summarise.
 *
 * It reports the **missing input**, not a missing output — a drawn area is the precondition for the run, and
 * the way `example`'s `issuesFor` names the port it needs.
 */
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

  // The whole store surface, and exactly what `run()` touches. `coordinates` is required: without a drawn
  // area there is nothing to summarise, and the flow gate keeps the node unplaceable until one exists.
  // `advancedParams` is declared because the module writes its summary there.
  params: [{ port: "coordinates", required: true }, { port: "advancedParams" }],

  // A different drawn area invalidates the summary this module wrote — the one real edge, and the reason the
  // step re-runs when it arrives stale. `affect.advancedParams` is deliberately **absent**: the module reads
  // that port only to merge into it, which is not an invalidation edge (compare `building-demand`, whose
  // read-only `buildingParams` merge is declared the same way).
  affect: { coordinates: ["advancedParams"] },

  // `overlay` is where an auto node shows its run state; `bottom` is its status strip. There is no `sidebar`
  // and no forward action — an auto node never has a Continue button.
  layout: ["overlay", "bottom"],

  // `seal` is left at the default, `at-completion`: one derived value, one writer, one natural transaction.

  run: async (ctx) => {
    const rings = ctx.read("coordinates");
    if (rings === undefined) {
      throw new Error("example-auto needs a drawn area before it can summarise one");
    }

    const summary = await areaSummarySource().summarise(rings);

    // Read the bag before writing into it: this is both the merge (keep another module's keys) and the
    // anti-clobber licence the engine requires before a port that already holds a value may be rewritten.
    const current = ctx.read("advancedParams") ?? {};
    if (!sameSummary(current[AREA_SUMMARY_KEY], summary)) {
      ctx.commit({ advancedParams: { ...current, [AREA_SUMMARY_KEY]: summary } });
    }
  },

  validate: (ctx) => issuesFor(ctx.store),
});

/**
 * The **full-screen state view** for an `auto` node — the only thing an auto node shows (`autoRun.ts`).
 *
 * There is no Continue button: the frame runs the node on arrival and advances by itself, so all this region
 * has to say is where the run is. `error` is the one state with a control — the **manual re-run** — and even
 * that does not advance on its own: a failed run stays put, so the retry is the user's decision.
 */
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

  // ── bottom: the status strip. Intrinsic height on purpose — its box is a cap, so a strip that fits renders
  //    as a strip. It says the node id and whether the store holds this module's summary, by colour and word.
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
  // The test data: the smallest inputs the module needs to do its work — a couple of small rings to
  // summarise. The source is not mocked here; the example ships a working default, and a test that wants a
  // different one installs it through `setAreaSummarySource`.
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
