/**
 * The `model-save` module — the terminal node, the only one that earns its keep by reporting rather than
 * collecting.
 *
 * It shows whether the model is ready to save, the `model.json` the store would produce (`buildModelPayload`),
 * and the save button. The node comes from `../../save/saveNode.ts`. The session is bound at startup via
 * `bindModelSaveSession`. Regions: `sidebar`, `bottom`.
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

/** The live session, filled in by the host once the workflow exists. Module-scope: the node outlives every render. */
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

/** The status the preview shows — the same rule the node applies when it saves, minus the node-identity subtlety. */
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
  // The test data: what makes the preview show a finished model rather than an empty one.
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
