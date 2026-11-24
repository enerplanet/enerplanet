/**
 * The `compare-variant` module — a small, at-a-glance comparison of a family's root model against the variant,
 * with a link to the full compare page.
 *
 * An interactive view: no `auto`, and it writes nothing. It declares `modelVariant` (required) and reads both
 * sides from that record. Both sides arrive through one injected slot (`source.ts`). Regions: `sidebar`,
 * `bottom`.
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
import {
  compareVariantGateway,
  useCompareVariant,
  type CompareVariantSummary,
  type SideState,
} from "./source";

/** The module's own surface, re-exported so a host installs a gateway through the module's entry point. */
export {
  setCompareVariantGateway,
  type CompareVariantGateway,
  type CompareVariantSummary,
} from "./source";

/** The route the full comparison lives at, for two finished models. */
export function comparePath(rootModelId: number, variantModelId: number): string {
  return `/app/simulation-reports?model1=${rootModelId}&model2=${variantModelId}`;
}

/** What this module stands behind: a variant to compare against. A variant with no results is not an issue. */
export function issuesFor(projection: Readonly<ModelData>): ValidationIssue[] {
  if (projection.modelVariant === undefined) {
    return [{ port: "modelVariant", message: "No variant of this model has been made yet, so there is nothing to compare." }];
  }
  return [];
}

const module = defineModule({
  id: "compare-variant",
  name: "Compare variant",

  // `modelVariant` (required) supplies both sides, so it is the whole input and orders this node after `model-variant`.
  params: [{ port: "modelVariant", required: true }],

  // It reads the pair and writes nothing, so nothing of its own can be invalidated.
  affect: {},

  // The comparison is a few lines in the sidebar; the strip in `bottom` names where the two fetches stand.
  layout: ["sidebar", "bottom"],

  run: (ctx) => {
    // A view commits nothing; the run still seals its zero-diff trace, which lets the node be marked done.
    ctx.commit({});
  },

  validate: (ctx) => issuesFor(ctx.store),
});

/** How a figure is rendered — one decimal, in the app's language; no unit conversion, no invented number. */
function formatNumber(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value);
}

/** A side's summary as rows, in display order — the shape the `dl` below walks. */
function summaryRows(
  summary: CompareVariantSummary,
  locale: string,
): { labelKey: string; value: string }[] {
  return [
    { labelKey: "modelBuilder.compare-variant.production", value: formatNumber(summary.sumProduction, locale) },
    { labelKey: "modelBuilder.compare-variant.consumption", value: formatNumber(summary.sumConsumption, locale) },
    { labelKey: "modelBuilder.compare-variant.peakDemand", value: formatNumber(summary.peakDemand, locale) },
  ];
}

/** One side of the comparison: its label and numbers, or the reason there are none (never zeros). */
const SidePanel: React.FC<{ labelKey: string; side: SideState }> = ({ labelKey, side }) => {
  const { t, i18n } = useTranslation();

  let body: ReactNode;
  if (side.status === "empty") {
    body = <p className="text-sm text-muted-foreground">{t("modelBuilder.compare-variant.notRun")}</p>;
  } else if (side.status === "failed") {
    body = <p className="text-sm text-destructive">{t("modelBuilder.compare-variant.failed")}</p>;
  } else if (side.status === "ready" && side.summary !== null) {
    body = (
      <dl className="space-y-1 text-sm">
        {summaryRows(side.summary, i18n.language).map((row) => (
          <div
            key={row.labelKey}
            className="flex items-baseline justify-between gap-3 border-b border-border/60 pb-1"
          >
            <dt className="text-muted-foreground">{t(row.labelKey)}</dt>
            <dd className="whitespace-nowrap tabular-nums text-foreground">{row.value}</dd>
          </div>
        ))}
      </dl>
    );
  } else {
    body = <p className="text-sm text-muted-foreground">{t("modelBuilder.compare-variant.loading")}</p>;
  }

  return (
    <div className="min-w-0 space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t(labelKey)}</p>
      {body}
    </div>
  );
};

/** The `bottom` region: a status strip naming the node and where its two fetches stand. */
const StatusStrip: React.FC<ModuleViewProps> = ({ data, nodeId }) => {
  const { t } = useTranslation();
  const { root, variant } = useCompareVariant(data.modelVariant);
  const noGateway = compareVariantGateway() === null;

  let status: ReactNode;
  if (noGateway) {
    status = <span className="text-destructive">{t("modelBuilder.compare-variant.bottom.noGateway")}</span>;
  } else if (root.status === "failed" || variant.status === "failed") {
    status = <span className="text-destructive">{t("modelBuilder.compare-variant.bottom.failed")}</span>;
  } else if (root.status === "loading" || variant.status === "loading") {
    status = <span className="text-muted-foreground">{t("modelBuilder.compare-variant.bottom.loading")}</span>;
  } else if (root.status === "ready" && variant.status === "ready") {
    status = <span className="text-emerald-600 dark:text-emerald-400">{t("modelBuilder.compare-variant.bottom.ready")}</span>;
  } else if (root.status === "empty" && variant.status === "empty") {
    status = <span className="text-amber-600 dark:text-amber-400">{t("modelBuilder.compare-variant.bottom.empty")}</span>;
  } else {
    status = <span className="text-amber-600 dark:text-amber-400">{t("modelBuilder.compare-variant.bottom.partial")}</span>;
  }

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
      <span className="font-medium">{nodeId}</span>
      <span className="flex items-baseline gap-1.5">
        <span className="font-mono text-xs text-muted-foreground">modelVariant</span>
        {status}
      </span>
    </div>
  );
};

/** The `sidebar` region: the two sides, the link to the full page, and the forward action. */
const Sidebar: React.FC<ModuleViewProps> = ({ data, run }) => {
  const { t } = useTranslation();
  const variant = data.modelVariant;
  const { root, variant: variantSide } = useCompareVariant(variant);
  // No host installed a gateway: a programmer error, reported with the fix rather than an empty panel.
  const noGateway = compareVariantGateway() === null;

  let body: ReactNode;
  if (variant === undefined) {
    // The gate already reports this (`issuesFor`); the view says it too, in case it is rendered on its own.
    body = <p className="shrink-0 text-sm text-muted-foreground">{t("modelBuilder.compare-variant.noVariant")}</p>;
  } else if (noGateway) {
    body = <p className="shrink-0 text-sm text-destructive">{t("modelBuilder.compare-variant.noGateway")}</p>;
  } else if (root.status === "failed" || variantSide.status === "failed") {
    body = <p className="shrink-0 text-sm text-destructive">{t("modelBuilder.compare-variant.failed")}</p>;
  } else if (root.status === "loading" || variantSide.status === "loading") {
    body = <p className="shrink-0 text-sm text-muted-foreground">{t("modelBuilder.compare-variant.loading")}</p>;
  } else {
    body = (
      <>
        <div className="shrink-0 grid grid-cols-2 gap-3">
          <SidePanel labelKey="modelBuilder.compare-variant.baseline" side={root} />
          <SidePanel labelKey="modelBuilder.compare-variant.comparison" side={variantSide} />
        </div>

        {/* A plain anchor: the module may not import react-router. No `target`, so it opens in this app and this tab. */}
        <a
          href={comparePath(variant.rootModelId, variant.variantModelId)}
          className="w-full shrink-0 rounded-lg border border-border px-3 py-2 text-center text-sm text-foreground hover:bg-muted"
        >
          {t("modelBuilder.compare-variant.link")}
        </a>
      </>
    );
  }

  return (
    <div className="flex h-full flex-col gap-4 overflow-auto">
      <div className="shrink-0">
        <h3 className="text-base font-semibold">{t("modelBuilder.compare-variant.title")}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{t("modelBuilder.compare-variant.description")}</p>
      </div>

      {body}

      {/* The forward action an interactive step needs; it commits nothing — pressing it is the zero-diff trace that marks the node done. */}
      <button
        type="button"
        onClick={() => void run()}
        className="mt-auto w-full shrink-0 rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground hover:opacity-90"
      >
        {t("modelBuilder.compare-variant.continue")}
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
  // The test data: the input the node cannot run without — a recorded variant, so the gate is satisfied.
  mock: {
    modelVariant: { variantModelId: 11, rootModelId: 1, title: "Base v1" },
  },
};

export default builderModule;
