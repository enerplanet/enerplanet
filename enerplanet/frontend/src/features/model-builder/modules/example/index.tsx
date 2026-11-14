/**
 * The example module — a working example, and the template to copy.
 *
 * It is deliberately **not** a step of any workflow. It is the shape every module should have: a
 * declared port surface, honest `affect`, mock inputs, a `validate`, and one UI per declared region.
 * Everything it does is small on purpose — the value is in the parts, not the job.
 *
 * It declares **all four slots** the frame offers, so it doubles as the demonstration of the frame:
 *
 *   sidebar   a form — read a port, edit a draft, commit through `run()`
 *   map       the transient map service — add a layer; nothing here is committed
 *   bottom    the status bar — one line summarising the projection
 *   overlay   the full-screen slot — a review panel, opened and closed via `OverlayControl`
 *
 * Scaffold a new one from it:
 *
 *   node src/features/model-builder/scripts/new-module.mjs <id> "Human label"
 *
 * The script copies this directory, rewrites the id and the label, and registers the entry.
 */

import { useState } from "react";
import {
  defineModule,
  type BuilderModule,
  type ModelData,
  type ModuleCtx,
  type ModuleViewProps,
  type PortKey,
  type ValidationIssue,
} from "@model-builder/core";
import { useTranslation } from "@spatialhub/i18n";

/**
 * The value the sidebar's form currently holds.
 *
 * A **transient UI draft, not model state** — and it is here because of a genuine gap worth knowing
 * about: `run()` takes no arguments, and the store is the only state a module has, so a form value has
 * nowhere else to go until the run boundary is widened to carry one. The host shows one module at a
 * time, so a single slot is enough; when the first real form module lands, decide between widening
 * `run()`/`ModuleCtx` with an input and letting a module own a factory-made session.
 */
let draftName: string | undefined;

/** The model needs a name — asked of any projection, so `validate()` and the review panel agree. */
function issuesFor(projection: Readonly<ModelData>): ValidationIssue[] {
  const name = projection.modelName;

  if (name === undefined || name.trim().length === 0) {
    return [{ port: "modelName", message: "The model needs a name." }];
  }
  return [];
}

const module = defineModule({
  id: "example",
  name: "Example module",

  // The module's whole store surface. Declaring it is not paperwork: an undeclared write is rejected,
  // and the flow gate reasons about `required` before the node is even allowed to run.
  params: [
    { port: "modelName" },
    { port: "resolution", required: true },
    { port: "fromDate" },
    { port: "toDate" },
  ],

  // Declared influence: writing `modelName` affects nothing downstream *here*. Keep this honest — the
  // influence-honesty prober (`core/influence.ts`) fails a module that understates it.
  affect: {},

  // Every slot the frame offers. A module that declares nothing is headless — that is how an `auto`
  // node renders nothing.
  layout: ["sidebar", "map", "bottom", "overlay"],

  run: (ctx) => {
    // Read before you write. `modelName` is seeded by the mock, and the write boundary refuses to
    // overwrite a value the module never looked at (anti-clobber).
    const current = ctx.read("modelName");
    const fromForm = draftName;
    draftName = undefined;

    const next = (fromForm ?? current ?? "").trim();
    ctx.commit({ modelName: next.length > 0 ? next : "Untitled model" });
  },

  validate: (ctx: ModuleCtx) => issuesFor(ctx.store),
});

/** The ports this module declares, for the review panel — derived, so it can never drift from `params`. */
const PORTS: readonly PortKey[] = module.params.map((param) => param.port);

const Component: React.FC<ModuleViewProps> = ({ region, data, run, nodeId, map, overlay }) => {
  const { t } = useTranslation();
  // What the user has typed since the last commit. Local on purpose: it is not state worth keeping.
  const [typed, setTyped] = useState<string | null>(null);

  if (region === "bottom") {
    return (
      <p className="text-sm text-muted-foreground">
        {t("modelBuilder.example.status", "{{node}}: “{{name}}”, resolution {{resolution}}", {
          node: nodeId,
          name: String(data.modelName ?? "—"),
          resolution: String(data.resolution ?? "—"),
        })}
      </p>
    );
  }

  if (region === "map") {
    return (
      <div className="space-y-3">
        <h3 className="text-base font-semibold">{t("modelBuilder.example.map.title")}</h3>
        <p className="text-sm text-muted-foreground">{t("modelBuilder.example.map.hint")}</p>
        <button
          type="button"
          onClick={() => {
            map?.removeLayer("example-layer");
            map?.addLayer("example-layer", { type: "Point", coordinates: [8.6, 49.4] });
          }}
          className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted"
        >
          {t("modelBuilder.example.map.addLayer")}
        </button>
      </div>
    );
  }

  if (region === "overlay") {
    const issues = issuesFor(data);

    return (
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold">{t("modelBuilder.example.overlay.title")}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{t("modelBuilder.example.overlay.hint")}</p>
          </div>
          <button
            type="button"
            onClick={() => overlay?.close()}
            className="shrink-0 rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted"
          >
            {t("modelBuilder.example.overlay.close")}
          </button>
        </div>

        <dl className="space-y-1 text-sm">
          {PORTS.map((port) => (
            <div key={port} className="flex items-baseline justify-between gap-4 border-b border-border/60 pb-1">
              <dt className="font-mono text-xs text-muted-foreground">{port}</dt>
              <dd>{String(data[port] ?? "—")}</dd>
            </div>
          ))}
        </dl>

        {issues.length === 0 ? (
          <p className="text-sm text-emerald-600 dark:text-emerald-400">
            {t("modelBuilder.example.overlay.complete")}
          </p>
        ) : (
          <ul className="space-y-1 text-sm text-destructive">
            {issues.map((issue) => (
              <li key={issue.message}>
                {t("modelBuilder.example.overlay.issue", "{{port}}: {{message}}", {
                  port: String(issue.port ?? "—"),
                  message: issue.message,
                })}
              </li>
            ))}
          </ul>
        )}

        <p className="text-xs text-muted-foreground">{t("modelBuilder.example.overlay.shellHint")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-semibold">{t("modelBuilder.example.title")}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{t("modelBuilder.example.description")}</p>
      </div>

      <div className="space-y-2">
        <label className="text-sm text-muted-foreground" htmlFor="example-name">
          {t("modelBuilder.example.nameLabel")}
        </label>
        <input
          id="example-name"
          // The draft wins while the user is typing; after a commit the store's value takes over again.
          value={typed ?? String(data.modelName ?? "")}
          onChange={(event) => {
            // A commit is the only way to change the store, so the keystroke is held here and taken by
            // `run()` below — see the note on `draftName`.
            draftName = event.target.value;
            setTyped(event.target.value);
          }}
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
        />
      </div>

      <button
        type="button"
        onClick={() => {
          void run().finally(() => setTyped(null));
        }}
        className="w-full rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground hover:opacity-90"
      >
        {t("modelBuilder.example.apply")}
      </button>

      <button
        type="button"
        onClick={() => overlay?.open()}
        className="w-full rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted"
      >
        {t("modelBuilder.example.review")}
      </button>

      <p className="border-t border-border pt-3 text-xs text-muted-foreground">
        {t("modelBuilder.example.rulesHint")}
      </p>
    </div>
  );
};

const builderModule: BuilderModule = {
  module,
  Component,
  // The inputs this module needs to do its work in isolation — the seed of the host's scratch store.
  // Keeping a required port here is what lets the contract test prove the module is runnable at all.
  // The name is deliberately padded: `run()` trims it, so the example does visible work out of the box.
  mock: {
    modelName: "  Example fixture  ",
    resolution: 60,
    fromDate: "2025-01-01",
    toDate: "2025-12-31",
  },
};

export default builderModule;
