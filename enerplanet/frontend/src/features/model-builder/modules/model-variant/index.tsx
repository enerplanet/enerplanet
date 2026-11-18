/**
 * The `model-variant` module — make a **family copy** of the saved model, record it, and switch this page onto
 * the copy.
 *
 * **What an interactive node is.** A step the user starts: there is no `auto`, nothing runs on arrival, and the
 * node carries its own forward action (`shell/actions.ts`: the frame's `Continue` is gone, so an interactive
 * module advances by running itself). Pressing the control runs `run()`, which creates the copy and commits the
 * record; a clean `validate()` then leaves the node behind.
 *
 * **Why this node exists.** A family comparison needs two models of one location: the family's original and a
 * variant of it. This node makes the variant. It creates the copy through an injected gateway (`./source.ts`)
 * that a host installs at startup — the module knows nothing of the app's HTTP client — and there is no default,
 * because a fabricated variant would be a lie about the backend.
 *
 * **What it commits, and why the record is a port.** The record of the copy — `modelVariant` in `core/ports.ts` —
 * names the copy and the family's root original. It is a **port** and not an `advancedParams` entry because the
 * compare node (E) declares it `required`, which is what places the comparison *after* this node by construction.
 * Adding the port was a core change.
 *
 * **The switch is the same transaction.** Alongside the record, `run()` writes `modelId` = the copy's id. The
 * node already reads `modelId`, so the write is the supported read → rewrite shape (`core/engine.ts`'s
 * anti-clobber rule licenses a port the module consumed), and a port a module both reads and rewrites is a
 * self-edge — its own write is not pruned by its own invalidation (`core/invalidate.ts`, `core/influence.ts`).
 * The consequences are the wanted ones: committing `modelId` *is* the switch — the frame renders this one store
 * and no page is navigated — and every node that reads `modelId` (both run nodes, the results node) is pruned
 * and left `stale`, which is how the run downstream re-runs against the variant. The copy's own session row is
 * the shell's job, not this node's: the row is a snapshot taken *after* this transaction seals, and the shell
 * owns the session (`shell/variantSession.ts`).
 *
 * **Copying twice is refused.** `run()` reads `modelVariant` before writing it, and uses the read as the guard:
 * a recorded variant means the copy was already made, so a second press seals a zero-diff step and forks
 * nothing. That is the same read-before-write the anti-clobber rule forces, doing the double duty the node needs.
 *
 * `seal` is left at the default, `at-completion`: the record and the switch are one record, one transaction.
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

/**
 * The module's own surface, re-exported: a host installs a gateway through the same entry point it imports the
 * module from, so it never reaches into the module's files. Same shape as `setMemeRunGateway`.
 */
export { setModelVariantGateway, type ModelVariantGateway } from "./source";

/**
 * What this module stands behind: a **variant it made**.
 *
 * An absent record means the copy has not been made, so the session rests on this node (the node stays `stale`)
 * and the user can still act — which is how this node requires its action before the flow moves on. Once the
 * record is present the gate is clean.
 */
export function issuesFor(projection: Readonly<ModelData>): ValidationIssue[] {
  if (projection.modelVariant === undefined) {
    return [{ port: "modelVariant", message: "No variant of this model has been made yet." }];
  }
  return [];
}

const module = defineModule({
  id: "model-variant",
  name: "Model variant",

  // `modelId` is required — the backend copies a saved model, and `model-save` is what produces the id. It is
  // read and, on a fork, rewritten: the switch (`run()`). `modelVariant` is what this node records.
  params: [
    { port: "modelId", required: true },
    { port: "modelVariant" },
  ],

  // The one edge: a different model is a different copy, so this record is invalidated with it — the variant
  // describes a model that changed. `run-meme-calliope` declares the same edge for its run record.
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

    // Read before writing — and the read is the guard against a second copy. A recorded variant means the copy
    // was already made, so pressing the control again seals a zero-diff step and never forks a second time.
    const existing = ctx.read("modelVariant");
    if (existing !== undefined) {
      ctx.commit({});
      return;
    }

    // The record and the switch, in one transaction. `modelId` was read above, so the rewrite is legal
    // (`core/engine.ts`) and it is a self-edge, so the node does not re-stale itself (`core/invalidate.ts`).
    const variant = await gateway.createVariant(modelId);
    ctx.commit({ modelVariant: variant, modelId: variant.variantModelId });
  },

  validate: (ctx) => issuesFor(ctx.store),
});

/**
 * The `bottom` region: a status strip naming the node and whether it has made a variant.
 *
 * Intrinsic height on purpose — its box is a cap, so a strip that fits renders as a strip.
 */
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

/**
 * The `sidebar` region: the node's description, what it did once a variant exists, and its forward action.
 *
 * The forward action is one control. Before a variant exists it creates it; after one exists the same control
 * re-seals the step (advancing without forking — see `run()`). Once a variant exists the sidebar states plainly
 * what the switch did: this page is now on the copy — its title and id — and the family's root original, which is
 * the id the comparison reads as its baseline. Everything shown comes from the `modelVariant` port; nothing here
 * is invented.
 */
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

      {/* The forward action an interactive step needs to be left behind — the frame renders none of its own
          (`shell/actions.ts`). It creates the variant once; pressed again it forks nothing and only re-seals. */}
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
  // The test data: the input the node cannot run without — a saved model. The gateway is not mocked here (the
  // module has no default); a test installs a fake through `setModelVariantGateway`.
  mock: {
    modelId: 1,
  },
};

export default builderModule;
