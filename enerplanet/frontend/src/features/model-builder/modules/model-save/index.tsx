/**
 * The `model-save` module — the terminal node, and the only module with a UI that earns its keep by
 * *reporting* rather than by collecting.
 *
 * **What it shows** (and deliberately nothing more): whether the model is ready to save, the exact
 * `model.json` the store would produce, and the button that saves it. There is no form here: every port
 * this node persists is produced upstream, so a field to type into would be a second way to say what
 * another node already said.
 *
 * **The conversion output is the point.** `model.json` is built by the feature's save path
 * (`buildModelPayload`), and showing it is what makes the conversion checkable — a wrong payload shape is
 * otherwise only visible after a round trip through the backend. The preview is the *proposal*: what would
 * go on the wire right now, status included.
 *
 * **Where the code comes from.** The node is `../../save/saveNode.ts`, and the preview reads
 * `../../save/saveModel.ts`. A module is meant to depend only on `@model-builder/core`, and the terminal
 * node is the one case where the module's whole job *is* the feature's save path: it is where `model.json`
 * is defined, so duplicating the builder here would be the copy most likely to drift from parity. It is a
 * documented seam — when modules are packaged separately this becomes a provider the host installs, the
 * same shape as `MAP_PROVIDER` and the grid engine.
 *
 * **The session is bound late**, like every other host-installed dependency: the frame builds a workflow
 * *around* this node, so it cannot receive the flow and registry as values. It reads them through a getter
 * the frame fills in — `bindModelSaveSession` — and until then the node is declared but refuses to run.
 */

import { useState } from "react";
import {
  type BuilderModule,
  type ModelData,
  type ModuleViewProps,
  type PortKey,
  type ValidationIssue,
} from "@model-builder/core";
import { useTranslation } from "@spatialhub/i18n";
import { createSaveNode, missingPorts, type SaveSession } from "../../save/saveNode";
import { buildModelPayload } from "../../save/saveModel";
import type { LegacyModelPayload, SaveStatus } from "../../save/gateway";

/**
 * The live session, filled in by the host once the workflow exists.
 *
 * Module-scope rather than React state for the same reason the draft store in `area-draw` is: the module's
 * `Component` renders once *per declared region*, so anything shared cannot live in a component. Here it is
 * not even per-render — the *node* needs it, and the node outlives every render.
 */
let session: SaveSession | null = null;

/** Give this node its session. The frame calls this when it builds (or rebuilds) a session. */
export function bindModelSaveSession(next: SaveSession | null): void {
  session = next;
}

const module = createSaveNode({ session: () => session });

/** The ports this module declares, for the verdict — derived from `params`, never copied. */
const PORTS: readonly PortKey[] = module.params.map((param) => param.port);

/** Which of them the flow insists on before the node may run at all. */
const REQUIRED = new Set(
  module.params.filter((param) => param.required === true).map((param) => param.port),
);

/**
 * The status the preview shows — the same rule the node applies when it actually saves, minus the
 * node-identity subtlety (the node counts every *other* node; a preview has no "self" to exclude until it
 * runs). An unfinished model previews as `incomplete`, which is what it would be saved as.
 */
function previewStatus(data: Readonly<ModelData>): SaveStatus {
  if (missingPorts(data).length > 0) return "incomplete";
  return data.modelId === undefined ? "draft" : "modified";
}

/** The `model.json` this store would produce right now. */
export function previewPayload(data: Readonly<ModelData>): LegacyModelPayload {
  return buildModelPayload(data, {
    workspaceId: data.workspaceId,
    status: previewStatus(data),
  });
}

/** How a port's value reads in a list — arrays summarised, because a grid printed in full is unreadable. */
function describeValue(value: unknown): string {
  if (value === undefined) return "";
  if (Array.isArray(value)) return `${value.length} entries`;
  if (typeof value === "object" && value !== null) {
    const entries = Object.keys(value as Record<string, unknown>).length;
    return `{ ${entries} key${entries === 1 ? "" : "s"} }`;
  }
  return String(value);
}

const Component: React.FC<ModuleViewProps> = ({ region, data, run, nodeId }) => {
  const { t } = useTranslation();
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const issues: ValidationIssue[] = missingPorts(data);
  const ready = issues.length === 0;

  const save = (): void => {
    setSaving(true);
    setResult(null);
    setFailed(false);
    void run()
      .then(() => setResult(t("modelBuilder.model-save.saved")))
      .catch((error: unknown) =>
        setResult(error instanceof Error ? error.message : String(error)),
      )
      .finally(() => {
        setSaving(false);
        setFailed(true);
      });
  };

  // ── bottom: one line. Whether this node is what the model is waiting on.
  if (region === "bottom") {
    return (
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
        <span className="font-medium">{nodeId}</span>
        <span className={ready ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}>
          {ready
            ? t("modelBuilder.model-save.bottom.ready")
            : t("modelBuilder.model-save.bottom.missing", "{{count}} missing", { count: issues.length })}
        </span>
      </div>
    );
  }

  // ── sidebar: the verdict, the payload, the action.
  return (
    <div className="flex h-full flex-col gap-4 overflow-auto">
      <div className="shrink-0">
        <h3 className="text-base font-semibold">{t("modelBuilder.model-save.title")}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{t("modelBuilder.model-save.description")}</p>
      </div>

      <div className="shrink-0">
        {ready ? (
          <p className="text-sm text-emerald-600 dark:text-emerald-400">
            {t("modelBuilder.model-save.ready")}
          </p>
        ) : (
          <ul className="space-y-1 text-sm text-destructive">
            {issues.map((issue) => (
              <li key={issue.message}>{issue.message}</li>
            ))}
          </ul>
        )}
      </div>

      <button
        type="button"
        onClick={save}
        disabled={saving}
        className="w-full shrink-0 rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {saving ? t("modelBuilder.model-save.saving") : t("modelBuilder.model-save.save")}
      </button>

      {result !== null && (
        <p className={`shrink-0 text-sm ${failed ? "text-destructive" : "text-emerald-600 dark:text-emerald-400"}`}>
          {result}
        </p>
      )}

      <div className="flex min-h-0 flex-1 flex-col gap-2">
        <h4 className="shrink-0 text-sm font-medium">{t("modelBuilder.model-save.conversion")}</h4>
        <pre className="min-h-0 flex-1 overflow-auto rounded-lg border border-border bg-background p-3 font-mono text-xs">
          {JSON.stringify(previewPayload(data), null, 2)}
        </pre>
      </div>

      <dl className="shrink-0 space-y-1 text-sm">
        {PORTS.map((port) => (
          <div key={port} className="flex items-baseline justify-between gap-4 border-b border-border/60 pb-1">
            <dt className="flex items-baseline gap-1.5 font-mono text-xs text-muted-foreground">
              {port}
              {REQUIRED.has(port) && (
                <span className="rounded bg-muted px-1 text-[0.65rem] uppercase">
                  {t("modelBuilder.model-save.required")}
                </span>
              )}
            </dt>
            <dd className={data[port] === undefined ? "text-amber-600 dark:text-amber-400" : ""}>
              {data[port] === undefined ? t("modelBuilder.model-save.notSet") : describeValue(data[port])}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
};

const builderModule: BuilderModule = {
  module,
  Component,
  // The test data: the inputs the node needs to be developed in isolation. `coordinates` is the port the
  // contract check insists on, and the rest is what makes the preview show a *finished* model rather than
  // an empty one — the only way to see the conversion output at all in test mode.
  mock: {
    modelName: "Example model",
    fromDate: "2025-01-01",
    toDate: "2025-12-31",
    resolution: 60,
    coordinates: [[[8.6, 49.4], [8.7, 49.4], [8.7, 49.5], [8.6, 49.4]]],
    buildings: { type: "FeatureCollection", features: [] },
    transformers: { type: "FeatureCollection", features: [] },
    lines: { type: "FeatureCollection", features: [] },
    mvLines: { type: "FeatureCollection", features: [] },
    grids: [],
  },
};

export default builderModule;
