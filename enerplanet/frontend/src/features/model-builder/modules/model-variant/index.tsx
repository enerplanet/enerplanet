/**
 * The `model-variant` module — make a family copy of the saved model, record it, and switch this page onto the
 * copy.
 *
 * An interactive node: pressing its control runs `run()`, which creates the copy and commits the record. The
 * copy is made through an injected gateway (`source.ts`); there is no default. It commits `modelVariant` and
 * writes `modelId` = the copy's id (the switch). Regions: `sidebar`, `bottom`.
 */

import {
  defineModule,
  type BuilderModule,
  type ModelData,
  type ModuleViewProps,
  type ValidationIssue,
} from "@model-builder/core";
import { useTranslation } from "@spatialhub/i18n";
import { modelVariantGateway } from "./source";

/** The module's own surface, re-exported so a host installs a gateway through the module's entry point. */
export { setModelVariantGateway, type ModelVariantGateway } from "./source";

/** What this module stands behind: a variant it made. */
export function issuesFor(projection: Readonly<ModelData>): ValidationIssue[] {
  if (projection.modelVariant === undefined) {
    return [{ port: "modelVariant", message: "No variant of this model has been made yet." }];
  }
  return [];
}

const module = defineModule({
  id: "model-variant",
  name: "Model variant",

  // `modelId` is required (the backend copies a saved model); it is read and, on a fork, rewritten. `modelVariant` is what this node records.
  params: [
    { port: "modelId", required: true },
    { port: "modelVariant" },
  ],

  // The one edge: a different model is a different copy, so this record is invalidated with it.
  affect: { modelId: ["modelVariant"] },

  // The form and the result it made are a handful of lines in the sidebar; `bottom` names where the copy stands.
  layout: ["sidebar", "bottom"],

  run: async (ctx) => {
    const gateway = modelVariantGateway();
    if (gateway === null) {
      throw new Error(
        "model-variant has no variant gateway: a host installs one with setModelVariantGateway() (shell/modelVariantGateway.ts)",
      );
    }

    const modelId = ctx.read("modelId");
    if (modelId === undefined) {
      throw new Error("model-variant needs a saved model (modelId) before it can make a variant");
    }

    // Read before writing — and the read is the guard against a second copy.
    const existing = ctx.read("modelVariant");
    if (existing !== undefined) {
      ctx.commit({});
      return;
    }

    // The record and the switch, in one transaction; `modelId` was read above, so the rewrite is legal and a self-edge.
    const variant = await gateway.createVariant(modelId);
    ctx.commit({ modelVariant: variant, modelId: variant.variantModelId });
  },

  validate: (ctx) => issuesFor(ctx.store),
});

/** The `bottom` region: a status strip naming the node and whether it has made a variant. */
const StatusStrip: React.FC<ModuleViewProps> = ({ data, nodeId }) => {
  const { t } = useTranslation();
  const variant = data.modelVariant;
  const status =
    variant === undefined ? (
      <span className="text-amber-600 dark:text-amber-400">
        {t("modelBuilder.model-variant.bottom.notSet")}
      </span>
    ) : (
      <span className="text-emerald-600 dark:text-emerald-400">
        {t("modelBuilder.model-variant.bottom.ready", "{{id}}", { id: variant.variantModelId })}
      </span>
    );

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

/** The `sidebar` region: the description, what the node did once a variant exists, and its forward action. */
const Sidebar: React.FC<ModuleViewProps> = ({ data, run }) => {
  const { t } = useTranslation();
  const variant = data.modelVariant;

  return (
    <div className="flex h-full flex-col gap-4 overflow-auto">
      <div className="shrink-0">
        <h3 className="text-base font-semibold">{t("modelBuilder.model-variant.title")}</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("modelBuilder.model-variant.description")}
        </p>
      </div>

      {variant !== undefined && (
        <div className="shrink-0 space-y-3">
          <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
            {t("modelBuilder.model-variant.switchedTo")}
          </p>
          <dl className="space-y-1 text-sm">
            <div className="flex items-baseline justify-between gap-4 border-b border-border/60 pb-1">
              <dt className="text-muted-foreground">{t("modelBuilder.model-variant.titleLabel")}</dt>
              <dd className="whitespace-nowrap text-foreground">{variant.title ?? "—"}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-4 border-b border-border/60 pb-1">
              <dt className="text-muted-foreground">{t("modelBuilder.model-variant.idLabel")}</dt>
              <dd className="whitespace-nowrap tabular-nums text-foreground">{variant.variantModelId}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-4 border-b border-border/60 pb-1">
              <dt className="text-muted-foreground">{t("modelBuilder.model-variant.rootLabel")}</dt>
              <dd className="whitespace-nowrap tabular-nums text-foreground">{variant.rootModelId}</dd>
            </div>
          </dl>
        </div>
      )}

      {/* The forward action an interactive step needs; it creates the variant once, and pressed again only re-seals. */}
      <button
        type="button"
        onClick={() => void run()}
        className="mt-auto w-full shrink-0 rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground hover:opacity-90"
      >
        {variant === undefined
          ? t("modelBuilder.model-variant.create")
          : t("modelBuilder.model-variant.continue")}
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
  // The test data: the input the node cannot run without — a saved model.
  mock: {
    modelId: 1,
  },
};

export default builderModule;
