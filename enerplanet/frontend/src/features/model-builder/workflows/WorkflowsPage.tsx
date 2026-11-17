/**
 * Workflows — the list, the create form, and the editor (plan §9).
 *
 * It lives inside `features/model-builder/` (plan §7) because the editor's palette **is** this feature's
 * module catalogue; a separate feature would need the project's first cross-feature import.
 *
 * Stage 1 (plan §6): this surface reads and writes the database, and the running builder still reads its
 * baked-in definition. So nothing here drives a run — it is a list of stored documents plus the editor.
 *
 * A stored flow may name a module the catalogue no longer declares. `toWorkflow` throws on that for the
 * builder's baked-in configuration, which is right there; here it is **user data**, so the editor reports
 * it by node and module instead of taking the surface down (`WorkflowEditor`).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "@spatialhub/i18n";
import { Copy, ExternalLink, Layers, Pencil, Plus, Trash2, Workflow as WorkflowIcon } from "lucide-react";
import { MODULES } from "../shell/moduleRegistry";
import { copyPayload, documentWithNodes, newDocument, slugify } from "./document";
import { workflowService } from "./service";
import type { WorkflowDocument, WorkflowNodeDocument, WorkflowSummary } from "./types";
import { WorkflowEditor } from "./WorkflowEditor";

/**
 * The example modules a developer copies to start a new module. The branch (`main`) is a placeholder to
 * update if the path moves: the directory lands on `main` only once the change introducing it is merged,
 * so this link 404s until then.
 */
const EXAMPLE_MODULES_URL =
  "https://github.com/enerplanet/enerplanet/tree/main/enerplanet/frontend/src/features/model-builder/modules/examples";

/** The editing session: the document on screen, and whether the server already has a row for it. */
interface Editing {
  document: WorkflowDocument;
  persisted: boolean;
}

/** Which kind the New form authors: an ordinary flow, or a fragment spliced into another (`isSubflow`). */
type NewKind = "flow" | "subflow";

function reasonOf(thrown: unknown): string {
  return thrown instanceof Error ? thrown.message : String(thrown);
}

const WorkflowsPage: React.FC = () => {
  const { t } = useTranslation();

  const [items, setItems] = useState<WorkflowSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [editing, setEditing] = useState<Editing | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [showNewForm, setShowNewForm] = useState(false);
  const [newKind, setNewKind] = useState<NewKind>("flow");
  const [newLabel, setNewLabel] = useState("");

  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setLoadError(null);
    try {
      setItems(await workflowService.list());
    } catch (thrown) {
      setLoadError(reasonOf(thrown));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openEditor = (summary: WorkflowSummary): void => {
    setSaveError(null);
    setDirty(false);
    setEditing({ document: summary.definition, persisted: true });
  };

  /** Open the New form for the kind being authored. Both kinds share it; only the document it builds differs. */
  const startNew = (kind: NewKind): void => {
    setNewKind(kind);
    setSaveError(null);
    setShowNewForm(true);
  };

  const createNew = (): void => {
    const label = newLabel.trim();
    if (label.length === 0) return;
    setSaveError(null);
    setDirty(true);
    // The same create path for both kinds: the id derives from the label (`newDocument` slugifies it) and
    // `isSubflow` is the one difference — a fragment, spliced into another flow and validated where inserted.
    setEditing({ document: newDocument(label, newKind === "subflow"), persisted: false });
    setShowNewForm(false);
    setNewLabel("");
  };

  const changeNodes = (nodes: readonly WorkflowNodeDocument[]): void => {
    setEditing((current) =>
      current === null ? current : { ...current, document: documentWithNodes(current.document, nodes) },
    );
    setDirty(true);
  };

  const save = useCallback(async (): Promise<void> => {
    if (editing === null) return;
    setSaving(true);
    setSaveError(null);
    try {
      const saved = editing.persisted
        ? await workflowService.update(editing.document.id, editing.document)
        : await workflowService.create(editing.document);
      setEditing({ document: saved.definition, persisted: true });
      setDirty(false);
      await load();
    } catch (thrown) {
      setSaveError(t("modelBuilder.workflows.error.save", "The workflow could not be saved: {{reason}}", { reason: reasonOf(thrown) }));
    } finally {
      setSaving(false);
    }
  }, [editing, load, t]);

  const copy = useCallback(async (summary: WorkflowSummary): Promise<void> => {
    try {
      await navigator.clipboard.writeText(copyPayload(summary.definition));
      setCopiedId(summary.workflow_id);
      window.setTimeout(() => setCopiedId(null), 1500);
    } catch (thrown) {
      setNotice(reasonOf(thrown));
    }
  }, []);

  /**
   * Delete asks first, and **refuses the default rather than doing it silently** (plan §9): the seeded
   * default is what a fresh database runs, and removing it would leave nothing runnable without saying so.
   */
  const remove = useCallback(
    async (summary: WorkflowSummary): Promise<void> => {
      if (summary.is_default) {
        setNotice(t("modelBuilder.workflows.deleteDefaultRefused", "The default workflow cannot be deleted."));
        return;
      }
      const confirmed = window.confirm(
        t("modelBuilder.workflows.deleteConfirm", "Delete \"{{label}}\"?", { label: summary.label }),
      );
      if (!confirmed) return;
      try {
        const result = await workflowService.remove(summary.workflow_id);
        setNotice(
          t("modelBuilder.workflows.deleteReport", "Deleted — {{sessions}} session(s) referenced it.", {
            sessions: result.sessions,
          }),
        );
        await load();
      } catch (thrown) {
        setNotice(reasonOf(thrown));
      }
    },
    [load, t],
  );

  const newId = useMemo(() => slugify(newLabel), [newLabel]);

  // Every stored row's document, the catalogue a subflow node's expansion resolves through. Built from the one
  // list call the page already makes, so a subflow costs no extra request (`shell/workflow.ts` reads the same
  // list the same way).
  const workflowDocuments = useMemo(() => items.map((item) => item.definition), [items]);

  // ── the editor, when one is open ───────────────────────────────────────────
  if (editing !== null) {
    return (
      <WorkflowEditor
        document={editing.document}
        catalogue={MODULES}
        workflows={workflowDocuments}
        persisted={editing.persisted}
        dirty={dirty}
        saving={saving}
        error={saveError}
        onChange={changeNodes}
        onSave={() => void save()}
        onBack={() => {
          setEditing(null);
          setDirty(false);
          setSaveError(null);
        }}
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border px-6 py-4">
        <WorkflowIcon className="h-5 w-5 text-muted-foreground" />
        <div>
          <h1 className="text-lg font-semibold text-foreground">{t("modelBuilder.workflows.title", "Workflows")}</h1>
          <p className="text-xs text-muted-foreground">
            {t("modelBuilder.workflows.subtitle", "Author the flows the Model Builder runs")}
          </p>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => startNew("flow")}
            className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            <Plus className="h-4 w-4" />
            {t("modelBuilder.workflows.new", "New workflow")}
          </button>

          <button
            type="button"
            onClick={() => startNew("subflow")}
            className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted"
          >
            <Layers className="h-4 w-4" />
            {t("modelBuilder.workflows.newSubflow", "New subflow")}
          </button>

          <a
            href={EXAMPLE_MODULES_URL}
            target="_blank"
            rel="noreferrer"
            title={t("modelBuilder.workflows.buildYourOwn", "Build your own module")}
            className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted"
          >
            <ExternalLink className="h-4 w-4" />
            {t("modelBuilder.workflows.buildYourOwn", "Build your own module")}
          </a>
        </div>
      </header>

      {/* New: asks for a label; the id derives from it (plan §9). */}
      {showNewForm && (
        <form
          className="flex shrink-0 flex-wrap items-end gap-3 border-b border-border bg-muted/40 px-6 py-3"
          onSubmit={(event) => {
            event.preventDefault();
            createNew();
          }}
        >
          {newKind === "subflow" && (
            <p className="w-full text-xs text-muted-foreground">
              {t(
                "modelBuilder.workflows.newForm.subflowNote",
                "A subflow is a fragment: it is spliced into another workflow and validated where it is inserted, not on its own.",
              )}
            </p>
          )}
          <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
            {t("modelBuilder.workflows.newForm.label", "Label")}
            <input
              autoFocus
              value={newLabel}
              onChange={(event) => setNewLabel(event.target.value)}
              className="w-64 rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
              placeholder="My flow"
            />
          </label>
          <p className="pb-1 font-mono text-[11px] text-muted-foreground">
            {t("modelBuilder.workflows.newForm.id", "id: {{id}}", { id: newId })}
          </p>
          <button
            type="submit"
            disabled={newId.length === 0}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t("modelBuilder.workflows.newForm.create", "Create")}
          </button>
          <button
            type="button"
            onClick={() => {
              setShowNewForm(false);
              setNewLabel("");
            }}
            className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted"
          >
            {t("modelBuilder.workflows.newForm.cancel", "Cancel")}
          </button>
        </form>
      )}

      {notice !== null && (
        <p className="shrink-0 border-b border-border bg-muted/40 px-6 py-2 text-sm text-muted-foreground">{notice}</p>
      )}

      <div className="min-h-0 flex-1 overflow-auto p-6">
        {loading ? (
          <p className="text-sm text-muted-foreground">{t("modelBuilder.workflows.loading", "Loading workflows…")}</p>
        ) : loadError !== null ? (
          <p className="text-sm text-destructive">
            {t("modelBuilder.workflows.loadError", "The workflows could not be loaded: {{reason}}", { reason: loadError })}
          </p>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("modelBuilder.workflows.empty", "No workflows yet.")}</p>
        ) : (
          <ul className="space-y-2">
            {items.map((summary) => (
              <li
                key={summary.workflow_id}
                className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 truncate text-sm font-medium text-foreground">
                    {summary.label}
                    {summary.is_default && (
                      <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                        {t("modelBuilder.workflows.defaultBadge", "default")}
                      </span>
                    )}
                  </p>
                  <p className="truncate font-mono text-[11px] text-muted-foreground">
                    {summary.workflow_id} · {t("modelBuilder.workflows.editor.version", "version {{version}}", { version: summary.version })}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => void copy(summary)}
                    className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs hover:bg-muted"
                    title={t("modelBuilder.workflows.copy", "Copy JSON")}
                  >
                    <Copy className="h-3.5 w-3.5" />
                    {copiedId === summary.workflow_id
                      ? t("modelBuilder.workflows.copied", "Copied")
                      : t("modelBuilder.workflows.copy", "Copy JSON")}
                  </button>
                  <button
                    type="button"
                    onClick={() => openEditor(summary)}
                    className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs hover:bg-muted"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    {t("modelBuilder.workflows.edit", "Edit")}
                  </button>
                  <button
                    type="button"
                    onClick={() => void remove(summary)}
                    className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    {t("modelBuilder.workflows.delete", "Delete")}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

export default WorkflowsPage;
