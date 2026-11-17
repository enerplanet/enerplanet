/**
 * The `result-overview` module — a small summary of what a model run produced, with a link to the full page.
 *
 * **An interactive view.** It is a step the user looks at and moves on from. There is no `auto`: nothing runs
 * on arrival, and no run is dispatched here — the run belongs to `run-meme-calliope`, and this node reads its
 * outcome. It declares `sidebar` (the summary) and `bottom` (a status strip); the summary is a handful of
 * lines, so the overlay would be more chrome than content.
 *
 * **It writes nothing, and that is the honest declaration.** A module's `params` is the store surface it may
 * *write* (`core/ports.ts`), and a viewer has nothing to commit. So the two ports it reads are declared and no
 * port is invented to give it one: `modelId` and `memeRun`, both `required`, which is also what places this
 * node *after* the run that produced the results — the port requirement is the ordering, by construction. Its
 * `run()` therefore commits nothing; it seals the zero-diff transaction an interactive step needs to be left
 * behind, which is exactly the trace a jump's re-arm clears.
 *
 * **Where the numbers come from.** The summary arrives through a slot the host installs (`./source.ts`,
 * `setResultOverviewGateway`); the module never learns the endpoint. There is no default: a missing gateway is
 * an error the view reports, naming the installer. The view handles all three states — loading, results, and a
 * failed fetch.
 *
 * **The link is a plain anchor.** A module may import only `@model-builder/core` and `@spatialhub/i18n`, so it
 * cannot use `react-router`'s `Link`/`useNavigate`, which is how the rest of the app navigates
 * (`features/model-dashboard/hooks/useModelDashboardHandlers.ts`: `navigate('/app/model-results/' + id)`). An
 * `<a href>` to the same route still opens the page in this app and this tab; it only forgoes the client-side
 * transition.
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

/**
 * The module's own surface, re-exported: a host installs a gateway through the same entry point it imports the
 * module from, so it never reaches into the module's files. Same shape as `setMemeRunGateway`.
 */
export {
  setResultOverviewGateway,
  type ResultOverviewGateway,
  type ResultOverviewSummary,
} from "./source";

/** Where the full results page lives — the route the model dashboard opens for a finished model. */
export function resultsPagePath(modelId: number): string {
  return `/app/model-results/${modelId}`;
}

/**
 * What this module stands behind: a **completed** Calliope run — with no results to show, there is nothing to
 * overview.
 *
 * An absent run, or one still `pending`/`running`, is unfinished, so the session rests on this node rather than
 * walking past a page with nothing in it. A `failed` run is reported with its own message, carried from the run
 * record's vocabulary. Once the run completed the gate is clean.
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
  id: "result-overview",
  name: "Result overview",

  // `modelId` (which model's page the summary is for) and `memeRun` (proof a run produced results) are both
  // required: the latter is what orders this node after `run-meme-calliope`. Nothing is written — see the file
  // comment — so no other port is declared.
  params: [
    { port: "modelId", required: true },
    { port: "memeRun", required: true },
  ],

  // It reads both ports and writes nothing, so nothing of its own can be invalidated: the honest answer is no
  // edges, not a pair invented to look connected.
  affect: {},

  // The summary is a few lines in the sidebar; the strip in `bottom` names where the fetch stands.
  layout: ["sidebar", "bottom"],

  run: (ctx) => {
    // A view commits nothing. The call is still made: a run that changes nothing seals its zero-diff trace,
    // which is what lets this node be marked done and left (`core/engine.ts`).
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

/**
 * The `bottom` region: a status strip naming the node and where its fetch stands.
 *
 * Intrinsic height on purpose — its box is a cap, so a strip that fits renders as a strip.
 */
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

        {/* A plain anchor: the module may not import react-router (see the file comment). No `target`, so it
            opens in this app and this tab. */}
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

      {/* The forward action an interactive step needs to be left behind — the frame renders none of its own
          (`shell/WorkflowBar.tsx`: "there is no forward control at all — an interactive module advances by
          running itself"). It commits nothing; pressing it is the zero-diff trace that marks the node done. */}
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
  // The test data: the inputs the node cannot run without — a saved model with a completed run, so its gate is
  // satisfied. The gateway is not mocked here (the module has no default); a test installs a fake through
  // `setResultOverviewGateway`.
  mock: {
    modelId: 1,
    memeRun: { framework: "calliope", status: "completed" },
  },
};

export default builderModule;
