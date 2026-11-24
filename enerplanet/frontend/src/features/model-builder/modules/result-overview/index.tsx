/**
 * The `result-overview` module — a small summary of what a model run produced, with a link to the full page.
 *
 * An interactive view: no `auto`, and it writes nothing. Declares `modelId` and `memeRun` (both required),
 * which orders it after the run that produced the results. The summary arrives through an injected slot
 * (`source.ts`). Regions: `sidebar`, `bottom`.
 */

import { type ReactNode } from "react";
import {
  defineModule,
  type BuilderModule,
  type ModelData,
  type ModuleViewProps,
  type ValidationIssue,
} from "@model-builder/core";
import { useTranslation } from "@spatialhub/i18n";
import { resultOverviewGateway, useResultOverview, type ResultOverviewSummary } from "./source";

/** The module's own surface, re-exported so a host installs a gateway through the module's entry point. */
export {
  setResultOverviewGateway,
  type ResultOverviewGateway,
  type ResultOverviewSummary,
} from "./source";

/** Where the full results page lives — the route the model dashboard opens for a finished model. */
export function resultsPagePath(modelId: number): string {
  return `/app/model-results/${modelId}`;
}

/** What this module stands behind: a completed Calliope run — with no results, there is nothing to overview. */
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
  id: "result-overview",
  name: "Result overview",

  // `modelId` (which model's page) and `memeRun` (proof a run produced results) are both required; nothing is written.
  params: [
    { port: "modelId", required: true },
    { port: "memeRun", required: true },
  ],

  // It reads both ports and writes nothing, so nothing of its own can be invalidated.
  affect: {},

  // The summary is a few lines in the sidebar; the strip in `bottom` names where the fetch stands.
  layout: ["sidebar", "bottom"],

  run: (ctx) => {
    // A view commits nothing; the run still seals its zero-diff trace, which lets the node be marked done.
    ctx.commit({});
  },

  validate: (ctx) => issuesFor(ctx.store),
});

/** How a figure is rendered — grouped, one decimal, in the app's language; no unit conversion, no invented number. */
function formatNumber(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value);
}

/** The summary as rows, in display order — the shape the `dl` below walks. */
function summaryRows(
  summary: ResultOverviewSummary,
  locale: string,
): { labelKey: string; value: string }[] {
  return [
    { labelKey: "modelBuilder.result-overview.production", value: formatNumber(summary.sumProduction, locale) },
    { labelKey: "modelBuilder.result-overview.consumption", value: formatNumber(summary.sumConsumption, locale) },
    { labelKey: "modelBuilder.result-overview.peakDemand", value: formatNumber(summary.peakDemand, locale) },
    { labelKey: "modelBuilder.result-overview.timesteps", value: formatNumber(summary.timestepCount, locale) },
    { labelKey: "modelBuilder.result-overview.locations", value: formatNumber(summary.locationCount, locale) },
    {
      labelKey: "modelBuilder.result-overview.carriers",
      value: summary.carriers.length === 0 ? formatNumber(0, locale) : summary.carriers.join(", "),
    },
  ];
}

/** The `bottom` region: a status strip naming the node and where its fetch stands. */
const StatusStrip: React.FC<ModuleViewProps> = ({ data, nodeId }) => {
  const { t } = useTranslation();
  const { summary, failed } = useResultOverview(data.modelId);
  const noGateway = resultOverviewGateway() === null;
  const loading = !noGateway && !failed && summary === null;

  let status: ReactNode;
  if (noGateway) {
    status = <span className="text-destructive">{t("modelBuilder.result-overview.bottom.noGateway")}</span>;
  } else if (loading) {
    status = <span className="text-muted-foreground">{t("modelBuilder.result-overview.bottom.loading")}</span>;
  } else if (failed) {
    status = <span className="text-destructive">{t("modelBuilder.result-overview.bottom.failed")}</span>;
  } else {
    status = (
      <span className="text-emerald-600 dark:text-emerald-400">
        {t("modelBuilder.result-overview.bottom.ready", "{{count}} carrier(s)", {
          count: summary?.carriers.length ?? 0,
        })}
      </span>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
      <span className="font-medium">{nodeId}</span>
      <span className="flex items-baseline gap-1.5">
        <span className="font-mono text-xs text-muted-foreground">memeRun</span>
        {status}
      </span>
    </div>
  );
};

/** The `sidebar` region: the summary, or the reason there is none yet, and the forward action. */
const Sidebar: React.FC<ModuleViewProps> = ({ data, run }) => {
  const { t, i18n } = useTranslation();
  // A summary that is `null` and not failed is one still owed, so `loading` folds into it.
  const { summary, failed } = useResultOverview(data.modelId);
  // No host installed a gateway: a programmer error, reported with the fix rather than an empty panel.
  const noGateway = resultOverviewGateway() === null;
  const loading = !noGateway && !failed && summary === null;

  let body: ReactNode;
  if (noGateway) {
    body = <p className="shrink-0 text-sm text-destructive">{t("modelBuilder.result-overview.noGateway")}</p>;
  } else if (loading) {
    body = <p className="shrink-0 text-sm text-muted-foreground">{t("modelBuilder.result-overview.loading")}</p>;
  } else if (failed || summary === null) {
    body = <p className="shrink-0 text-sm text-destructive">{t("modelBuilder.result-overview.failed")}</p>;
  } else {
    body = (
      <>
        <dl className="shrink-0 space-y-1 text-sm">
          {summaryRows(summary, i18n.language).map((row) => (
            <div
              key={row.labelKey}
              className="flex items-baseline justify-between gap-4 border-b border-border/60 pb-1"
            >
              <dt className="text-muted-foreground">{t(row.labelKey)}</dt>
              <dd className="whitespace-nowrap tabular-nums text-foreground">{row.value}</dd>
            </div>
          ))}
        </dl>

        {/* A plain anchor: the module may not import react-router. No `target`, so it opens in this app and this tab. */}
        <a
          href={resultsPagePath(data.modelId ?? 0)}
          className="w-full shrink-0 rounded-lg border border-border px-3 py-2 text-center text-sm text-foreground hover:bg-muted"
        >
          {t("modelBuilder.result-overview.link")}
        </a>
      </>
    );
  }

  return (
    <div className="flex h-full flex-col gap-4 overflow-auto">
      <div className="shrink-0">
        <h3 className="text-base font-semibold">{t("modelBuilder.result-overview.title")}</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("modelBuilder.result-overview.description")}
        </p>
      </div>

      {body}

      {/* The forward action an interactive step needs; it commits nothing — pressing it is the zero-diff trace that marks the node done. */}
      <button
        type="button"
        onClick={() => void run()}
        className="mt-auto w-full shrink-0 rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground hover:opacity-90"
      >
        {t("modelBuilder.result-overview.continue")}
      </button>
    </div>
  );
};

/** One component, one region: the frame renders this once per declared region. */
const Component: React.FC<ModuleViewProps> = (props) =>
  props.region === "bottom" ? <StatusStrip {...props} /> : <Sidebar {...props} />;

const builderModule: BuilderModule = {
  module,
  Component,
  // The test data: the inputs the node cannot run without — a saved model with a completed run.
  mock: {
    modelId: 1,
    memeRun: { framework: "calliope", status: "completed" },
  },
};

export default builderModule;
