/**
 * The workflow editor — a linear chain, and the palette that gates what may be appended (plan §9).
 *
 * The chain is the document's `nodes`, in order. Appending offers a module only once every `required` port
 * it declares is produced by the chain so far; the palette lists the whole catalogue and greys what cannot
 * go next, naming the port it waits for. **The gate is editor-level guidance, not a core invariant** — a
 * module may declare a port it never writes, so the engine, not this palette, decides whether a node runs
 * (`gate.ts` carries the full caveat).
 *
 * Removing an entry drops it and everything after it: a linear chain cannot have a hole, and the confirm
 * says so. Unsaved changes are shown in the header.
 */

import { useMemo, useState } from "react";
import { useTranslation } from "@spatialhub/i18n";
import { ArrowLeft, Plus, Save, Trash2 } from "lucide-react";
import { declaredPorts } from "../core/module";
import type { BuilderModule } from "../shell/contract";
import { appendModule, removeFrom, removedCount } from "./chain";
import { paletteFor, type PaletteEntry } from "./gate";
import type { WorkflowDocument, WorkflowNodeDocument } from "./types";

export interface WorkflowEditorProps {
  document: WorkflowDocument;
  catalogue: readonly BuilderModule[];
  /** Whether the server already has a row for this document (create vs. update on save). */
  persisted: boolean;
  dirty: boolean;
  saving: boolean;
  error: string | null;
  onChange: (nodes: readonly WorkflowNodeDocument[]) => void;
  onSave: () => void;
  onBack: () => void;
}

/** One port as a chip. `missing` styles the ports a module is still waiting for. */
const PortChip: React.FC<{ port: string; missing?: boolean }> = ({ port, missing }) => (
  <span
    className={
      missing
        ? "rounded bg-amber-100 px-1.5 py-0.5 font-mono text-[11px] text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
        : "rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground"
    }
  >
    {port}
  </span>
);

const PaletteRow: React.FC<{ entry: PaletteEntry; onAdd: () => void }> = ({ entry, onAdd }) => {
  const { t } = useTranslation();
  const { module, missing, available } = entry;
  const surface = declaredPorts(module.module);

  return (
    <li
      className={`flex items-start gap-3 rounded-lg border p-3 ${
        available
          ? "border-border bg-card"
          : "border-dashed border-border bg-muted/40 opacity-70"
      }`}
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{module.module.name ?? module.module.id}</p>
        <p className="truncate font-mono text-[11px] text-muted-foreground">{module.module.id}</p>

        {surface.length > 0 && (
          <p className="mt-1 flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
            <span>{t("modelBuilder.workflows.editor.produces", "produces")}</span>
            {surface.map((port) => (
              <PortChip key={port} port={port} />
            ))}
          </p>
        )}

        {/* The refusal says which port it is waiting for, rather than only that it is refused. */}
        {!available && (
          <p className="mt-1 flex flex-wrap items-center gap-1 text-[11px] text-amber-700 dark:text-amber-400">
            <span>{t("modelBuilder.workflows.editor.needs", "needs")}</span>
            {missing.map((port) => (
              <PortChip key={port} port={port} missing />
            ))}
          </p>
        )}
      </div>

      <button
        type="button"
        onClick={onAdd}
        disabled={!available}
        className="shrink-0 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-30"
      >
        <span className="flex items-center gap-1">
          <Plus className="h-3 w-3" />
          {t("modelBuilder.workflows.editor.add", "Add")}
        </span>
      </button>
    </li>
  );
};

export const WorkflowEditor: React.FC<WorkflowEditorProps> = ({
  document,
  catalogue,
  persisted,
  dirty,
  saving,
  error,
  onChange,
  onSave,
  onBack,
}) => {
  const { t } = useTranslation();
  const [pendingRemove, setPendingRemove] = useState<number | null>(null);

  const byId = useMemo(
    () => new Map(catalogue.map((entry) => [entry.module.id, entry])),
    [catalogue],
  );
  const palette = useMemo(() => paletteFor(catalogue, document.nodes), [catalogue, document.nodes]);

  const remove = (index: number): void => {
    onChange(removeFrom(document.nodes, index));
    setPendingRemove(null);
  };

  const askRemove = (index: number): void => {
    // The last entry drops nothing but itself, so there is no consequence to confirm. Anything earlier
    // takes its dependents with it, and that is what the confirm states.
    if (removedCount(document.nodes, index) <= 1) remove(index);
    else setPendingRemove(index);
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      {/* Header — label, id, version, and the unsaved marker. */}
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border px-6 py-3">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-sm text-muted-foreground hover:bg-muted"
        >
          <ArrowLeft className="h-4 w-4" />
          {t("modelBuilder.workflows.editor.back", "Back")}
        </button>

        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold text-foreground">{document.label}</h2>
          <p className="truncate font-mono text-[11px] text-muted-foreground">
            {document.id} · {t("modelBuilder.workflows.editor.version", "version {{version}}", { version: document.version })}
          </p>
        </div>

        <span className="ml-auto flex items-center gap-3">
          {dirty ? (
            <span className="text-xs font-medium text-amber-600 dark:text-amber-400">
              {t("modelBuilder.workflows.editor.unsaved", "Unsaved changes")}
            </span>
          ) : (
            persisted && (
              <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
                {t("modelBuilder.workflows.editor.saved", "Saved")}
              </span>
            )
          )}

          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Save className="h-4 w-4" />
            {saving
              ? t("modelBuilder.workflows.editor.saving", "Saving…")
              : t("modelBuilder.workflows.editor.save", "Save")}
          </button>
        </span>
      </header>

      {error !== null && (
        <p className="shrink-0 border-b border-destructive/40 bg-destructive/10 px-6 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-auto p-6 lg:flex-row">
        {/* The chain, in order. */}
        <section className="min-w-0 flex-1">
          <h3 className="mb-2 text-sm font-semibold text-foreground">
            {t("modelBuilder.workflows.editor.chain", "Chain")}
          </h3>

          {document.nodes.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
              {t("modelBuilder.workflows.editor.chainEmpty", "The chain is empty. Add a module to begin.")}
            </p>
          ) : (
            <ol className="space-y-2">
              {document.nodes.map((node, index) => {
                const entry = byId.get(node.moduleId);
                return (
                  <li
                    key={node.id}
                    className="flex items-start gap-3 rounded-lg border border-border bg-card p-3"
                  >
                    <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
                      {index + 1}
                    </span>

                    <div className="min-w-0 flex-1">
                      {entry === undefined ? (
                        // A stored flow may name a module this build no longer declares. That is a data
                        // condition to report — naming node and module — not an exception that takes the
                        // surface down (plan §3).
                        <p className="text-sm text-destructive">
                          {t("modelBuilder.workflows.editor.unknownModule", "Unknown module \"{{moduleId}}\" at node \"{{nodeId}}\".", { moduleId: node.moduleId, nodeId: node.id })}
                        </p>
                      ) : (
                        <>
                          <p className="truncate text-sm font-medium text-foreground">
                            {node.label ?? entry.module.name ?? node.moduleId}
                          </p>
                          <p className="truncate font-mono text-[11px] text-muted-foreground">{node.moduleId}</p>
                          {declaredPorts(entry.module).length > 0 && (
                            <p className="mt-1 flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
                              {declaredPorts(entry.module).map((port) => (
                                <PortChip key={port} port={port} />
                              ))}
                            </p>
                          )}
                        </>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => askRemove(index)}
                      className="shrink-0 rounded-md border border-border p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive"
                      aria-label={t("modelBuilder.workflows.editor.remove", "Remove")}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </li>
                );
              })}
            </ol>
          )}

          {/* The consequence of a middle cut, stated where the click happened. */}
          {pendingRemove !== null && (
            <div className="mt-3 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">
              <p className="text-destructive">
                {t(
                  "modelBuilder.workflows.editor.removeConfirm",
                  "Removing this step also removes everything after it — a linear chain cannot have a hole. Remove {{count}} step(s)?",
                  { count: removedCount(document.nodes, pendingRemove) },
                )}
              </p>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => remove(pendingRemove)}
                  className="rounded-md bg-destructive px-3 py-1 text-sm text-destructive-foreground hover:opacity-90"
                >
                  {t("modelBuilder.workflows.editor.remove", "Remove")}
                </button>
                <button
                  type="button"
                  onClick={() => setPendingRemove(null)}
                  className="rounded-md border border-border px-3 py-1 text-sm hover:bg-muted"
                >
                  {t("modelBuilder.workflows.newForm.cancel", "Cancel")}
                </button>
              </div>
            </div>
          )}
        </section>

        {/* The palette — the whole catalogue, gated. */}
        <section className="min-w-0 flex-1 lg:max-w-sm">
          <h3 className="mb-2 text-sm font-semibold text-foreground">
            {t("modelBuilder.workflows.editor.palette", "Modules")}
          </h3>
          <p className="mb-3 text-xs text-muted-foreground">
            {t(
              "modelBuilder.workflows.editor.gateHint",
              "A module can be added once the chain already produces every port it requires.",
            )}
          </p>
          <ul className="space-y-2">
            {palette.map((entry) => (
              <PaletteRow
                key={entry.module.module.id}
                entry={entry}
                onAdd={() => onChange(appendModule(document.nodes, entry.module))}
              />
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
};

export default WorkflowEditor;
