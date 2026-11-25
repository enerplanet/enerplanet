/**
 * The workflow editor — a linear chain, and the palette that gates what may be appended.
 *
 * The chain is the document's `nodes`, in order. The palette lists the whole catalogue and greys what cannot
 * go next, naming the port it waits for. A **subflow** is not a module: its own control opens a picker
 * (`subflowCandidates`), and a chosen subflow renders as a **bracket** around the expansion of the workflow
 * it references. Removing an entry drops it and everything after it.
 */

import { useMemo, useState } from "react";
import { useTranslation } from "@spatialhub/i18n";
import { ArrowDown, ArrowLeft, ArrowUp, ChevronRight, Layers, Plus, Repeat, Save, Trash2, TriangleAlert } from "lucide-react";
import type { FlowNode, ModuleRegistry } from "../core/flow";
import { declaredPorts, isHostModule } from "../core/module";
import type { PortKey } from "../core/ports";
import type { BuilderModule } from "../shell/contract";
import {
  appendModule,
  appendSubflow,
  chooseSubflowWorkflow,
  moveNode,
  removeFrom,
  removedCount,
  type MoveDirection,
} from "./chain";
import { expand, type WorkflowLookup } from "./expand";
import {
  fragmentRequiredPorts,
  moveIsAllowed,
  paletteFor,
  producedPorts,
  type MoveVerdict,
  type PaletteEntry,
} from "./gate";
import { subflowCandidates, type SubflowCandidate } from "./subflow";
import {
  recommendedNode,
  recommendedSubflow,
  sectionKey,
  updatedSection,
  withSection,
  withSectionNode,
  withoutSection,
  withoutSectionNode,
} from "./recommendedEdit";
import type { RecommendedSection, SubflowNodeDocument, WorkflowDocument, WorkflowNodeDocument } from "./types";
import { documentProblem, isSubflowNode } from "./types";

export interface WorkflowEditorProps {
  document: WorkflowDocument;
  catalogue: readonly BuilderModule[];
  /** Every stored workflow with its document — the picker's candidates and the lookup a subflow resolves through. */
  workflows: readonly WorkflowDocument[];
  /** Whether the server already has a row for this document (create vs. update on save). */
  persisted: boolean;
  dirty: boolean;
  saving: boolean;
  error: string | null;
  /** The document as edited — the editor authors both the chain and the `recommended` map. */
  onChange: (document: WorkflowDocument) => void;
  onSave: () => void;
  onBack: () => void;
}

/** The remove control's label key — shared by the module row, the subflow bracket and the confirm button. */
const REMOVE_KEY = "modelBuilder.workflows.editor.remove";

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

/**
 * The up/down controls for one chain entry; a refused direction is rendered disabled with the ports it would
 * leave unmet. Movement is a button rather than a drag because the editor is tested in a node environment
 * with no DOM.
 */
const MoveControls: React.FC<{
  index: number;
  first: boolean;
  last: boolean;
  up: MoveVerdict;
  down: MoveVerdict;
  onMove: (index: number, direction: MoveDirection) => void;
  children?: React.ReactNode;
}> = ({ index, first, last, up, down, onMove, children }) => {
  const { t } = useTranslation();
  const buttonClass =
    "shrink-0 rounded-md border border-border p-1.5 text-muted-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-30";

  const refusal = (verdict: MoveVerdict): React.ReactNode =>
    verdict.ok ? null : (
      <p className="flex flex-wrap items-center justify-end gap-1 text-[11px] text-amber-700 dark:text-amber-400">
        <span>{t("modelBuilder.workflows.editor.moveBlocked", "this move would leave these ports unmet:")}</span>
        {verdict.missing.map((port) => (
          <PortChip key={port} port={port} missing />
        ))}
      </p>
    );

  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onMove(index, "up")}
          disabled={first || !up.ok}
          className={buttonClass}
          aria-label={t("modelBuilder.workflows.editor.moveUp", "Move up")}
        >
          <ArrowUp className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => onMove(index, "down")}
          disabled={last || !down.ok}
          className={buttonClass}
          aria-label={t("modelBuilder.workflows.editor.moveDown", "Move down")}
        >
          <ArrowDown className="h-4 w-4" />
        </button>
        {children}
      </div>
      {!first && refusal(up)}
      {!last && refusal(down)}
    </div>
  );
};

/** The fragment notice: validation is off while editing a fragment, plus the ports it will need from the flow that inserts it.
 *
 * `inputs === null` means the fragment could not be flattened, so the notice names nothing.
 */
const FragmentNotice: React.FC<{ inputs: readonly PortKey[] | null }> = ({ inputs }) => {
  const { t } = useTranslation();

  return (
    <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/30">
      <p className="flex items-start gap-1.5 text-sm font-medium text-amber-800 dark:text-amber-300">
        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          {t(
            "modelBuilder.workflows.editor.fragmentWarning",
            "Validation is off while editing a fragment: its requirements are read where it is inserted, so its modules are not gated here.",
          )}
        </span>
      </p>

      {inputs !== null && (
        <div className="mt-2 text-[11px] text-amber-800 dark:text-amber-300">
          {inputs.length === 0 ? (
            <p>
              {t(
                "modelBuilder.workflows.editor.fragmentInputsNone",
                "This fragment needs nothing from the flow around it.",
              )}
            </p>
          ) : (
            <p className="flex flex-wrap items-center gap-1">
              <span>{t("modelBuilder.workflows.editor.fragmentInputs", "Needs from the flow that inserts it:")}</span>
              {inputs.map((port) => (
                <PortChip key={port} port={port} missing />
              ))}
            </p>
          )}
        </div>
      )}
    </div>
  );
};

/** The subflow picker: every stored workflow, its label and description, and the verdict as a row state. */
const SubflowPicker: React.FC<{
  candidates: readonly SubflowCandidate[];
  current: string | null;
  onChoose: (workflowId: string) => void;
  onCancel: () => void;
}> = ({ candidates, current, onChoose, onCancel }) => {
  const { t } = useTranslation();

  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-foreground">
          {t("modelBuilder.workflows.editor.addSubflow", "Insert a workflow")}
        </p>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-border px-2.5 py-1 text-xs hover:bg-muted"
        >
          {t("modelBuilder.workflows.newForm.cancel", "Cancel")}
        </button>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        {t(
          "modelBuilder.workflows.editor.subflowPickerHint",
          "A workflow is spliced in at this position; the fragment workflows are listed first.",
        )}
      </p>

      {candidates.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("modelBuilder.workflows.editor.subflowNone", "No stored workflows to insert.")}
        </p>
      ) : (
        <ul className="space-y-2">
          {candidates.map((candidate) => {
            const ok = candidate.verdict.ok;
            return (
              <li
                key={candidate.document.id}
                className={`flex items-start gap-3 rounded-lg border p-3 ${
                  ok ? "border-border bg-card" : "border-dashed border-border bg-muted/40 opacity-70"
                }`}
              >
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 truncate text-sm font-medium text-foreground">
                    {candidate.document.label}
                    {candidate.fragment && (
                      <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[11px] font-semibold text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">
                        {t("modelBuilder.workflows.editor.fragment", "fragment")}
                      </span>
                    )}
                    {current === candidate.document.id && (
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground">
                        {t("modelBuilder.workflows.editor.current", "current")}
                      </span>
                    )}
                  </p>
                  <p className="truncate font-mono text-[11px] text-muted-foreground">{candidate.document.id}</p>

                  {candidate.document.description !== undefined && candidate.document.description !== "" && (
                    <p className="mt-1 text-[11px] text-muted-foreground">{candidate.document.description}</p>
                  )}

                  {!ok && (
                    <p className="mt-1 flex flex-wrap items-center gap-1 text-[11px] text-amber-700 dark:text-amber-400">
                      {candidate.verdict.reason === "missing" ? (
                        <>
                          <span>{t("modelBuilder.workflows.editor.needs", "needs")}</span>
                          {candidate.verdict.missing.map((port) => (
                            <PortChip key={port} port={port} missing />
                          ))}
                        </>
                      ) : (
                        <span>
                          {candidate.verdict.reason === "recursive"
                            ? t(
                                "modelBuilder.workflows.editor.recursive",
                                "would contain this workflow - a subflow cannot include itself, directly or transitively",
                              )
                            : t(
                                "modelBuilder.workflows.editor.unresolved",
                                "cannot be resolved - it names a module or workflow this build does not have",
                              )}
                        </span>
                      )}
                    </p>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => onChoose(candidate.document.id)}
                  disabled={!ok}
                  className="shrink-0 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-30"
                >
                  {t("modelBuilder.workflows.editor.choose", "Insert")}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

/** Suggested next steps, authored: a wrapping grid of suggestion cards, always offered for the chain's tail. */
const RecommendedPanel: React.FC<{
  recommended: readonly RecommendedSection[] | undefined;
  problem: string | undefined;
  catalogue: readonly BuilderModule[];
  workflows: readonly WorkflowDocument[];
  onChange: (recommended: RecommendedSection[]) => void;
}> = ({ recommended, problem, catalogue, workflows, onChange }) => {
  const { t } = useTranslation();
  const [suggestionDraft, setSuggestionDraft] = useState<{ title: string; why: string } | null>(null);
  const [nodePicks, setNodePicks] = useState<Record<string, string>>({});
  /** Folded until the author opens it, so the panel stays out of the way by default. */
  const [open, setOpen] = useState(false);

  const list = recommended ?? [];
  const nodeModules = catalogue.filter((entry) => !isHostModule(entry.module));
  const byId = useMemo(() => new Map(catalogue.map((entry) => [entry.module.id, entry])), [catalogue]);
  /** A node's human label: its own label, else the catalogue's name, else its name. */
  const labelFor = (node: WorkflowNodeDocument): string =>
    isSubflowNode(node)
      ? node.label ?? node.workflows[0] ?? node.id
      : node.label ?? byId.get(node.moduleId)?.module.name ?? node.moduleId;
  /** Every key already in the document, so a derived key stays unique document-wide. */
  const takenKeys = list.map((suggestion) => suggestion.key);

  const addSuggestion = (): void => {
    if (suggestionDraft === null) return;
    const title = suggestionDraft.title.trim();
    if (title.length === 0) return;
    onChange(
      withSection(list, {
        key: sectionKey(title, takenKeys),
        label: suggestionDraft.title,
        description: suggestionDraft.why,
        nodes: [],
      }),
    );
    setSuggestionDraft(null);
  };

  const addNode = (suggestion: RecommendedSection): void => {
    const pick = nodePicks[suggestion.key] ?? "";
    const at = pick.indexOf(":");
    if (at < 0) return;
    const kind = pick.slice(0, at);
    const id = pick.slice(at + 1);
    let node: WorkflowNodeDocument | undefined;
    if (kind === "module") {
      const module = nodeModules.find((entry) => entry.module.id === id);
      if (module !== undefined) node = recommendedNode(module, suggestion.nodes);
    } else if (kind === "workflow") {
      node = recommendedSubflow(id, suggestion.nodes);
    }
    if (node === undefined) return;
    onChange(withSectionNode(list, suggestion.key, node));
    setNodePicks((current) => ({ ...current, [suggestion.key]: "" }));
  };

  return (
    <section className="rounded-lg border border-border bg-card">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 p-3 text-left"
      >
        <ChevronRight
          className={
            open
              ? "h-4 w-4 shrink-0 rotate-90 text-muted-foreground transition-transform"
              : "h-4 w-4 shrink-0 text-muted-foreground transition-transform"
          }
        />
        <span className="text-sm font-semibold text-foreground">
          {t("modelBuilder.workflows.editor.suggested", "Suggested next steps")}
        </span>
      </button>

      {/* Shown open or folded: folding it away must not hide the fault a save refuses on. */}
      {problem !== undefined && (
        <p className="mx-3 mb-3 flex items-start gap-1.5 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {t("modelBuilder.workflows.editor.suggestedProblem", "The suggested next steps are malformed: {{reason}}", {
              reason: problem,
            })}
          </span>
        </p>
      )}

      {/* Shown by CSS rather than rendered conditionally: this harness asserts static markup, so a
          folded body has to stay in the DOM to be covered. */}
      <div className={open ? "px-3 pb-3" : "hidden px-3 pb-3"}>
        <p className="mb-3 text-xs text-muted-foreground">
          {t(
            "modelBuilder.workflows.editor.suggestedHint",
            "Follow-up steps offered once the chain's last step has run. Each suggestion is appended as one unit.",
          )}
        </p>

        {/* Cards in a wrapping grid rather than a full-width list: a field and its own button stay inside
            one narrow card, instead of drifting to opposite edges of a wide screen. */}
        <div className="flex flex-wrap items-stretch gap-3">
          {list.length === 0 && suggestionDraft === null && (
            <p className="w-full rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
              {t("modelBuilder.workflows.editor.suggestedEmpty", "No suggestions yet. Add a suggestion below to begin.")}
            </p>
          )}

          {list.map((section) => (
            <article
              key={section.key}
              className="flex w-full flex-col gap-3 rounded-lg border border-border bg-card p-3 sm:w-[20rem]"
            >
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1 space-y-2">
                  <label className="block">
                    <span className="text-[11px] text-muted-foreground">
                      {t("modelBuilder.workflows.editor.suggestionTitle", "Title")}
                    </span>
                    <input
                      defaultValue={section.label}
                      onBlur={(event) => onChange(updatedSection(list, section.key, { label: event.target.value }))}
                      className="mt-0.5 w-full rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
                    />
                  </label>
                  <label className="block">
                    <span className="text-[11px] text-muted-foreground">
                      {t("modelBuilder.workflows.editor.suggestionWhy", "Why (the goal)")}
                    </span>
                    <input
                      defaultValue={section.description}
                      onBlur={(event) =>
                        onChange(updatedSection(list, section.key, { description: event.target.value }))
                      }
                      className="mt-0.5 w-full rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
                    />
                  </label>
                </div>

                <button
                  type="button"
                  onClick={() => onChange(withoutSection(list, section.key))}
                  className="shrink-0 rounded-md border border-border p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive"
                  aria-label={t(REMOVE_KEY, "Remove")}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>

              {/* `flex-1` + `mt-auto` on the picker: cards in a row share a height, and the Add control
                  settles at the card's foot so it lines up across the row. */}
              <div className="flex flex-1 flex-col border-t border-border pt-3">
                {section.nodes.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground">
                    {t("modelBuilder.workflows.editor.noNodes", "No nodes.")}
                  </p>
                ) : (
                  <ol className="space-y-1">
                    {section.nodes.map((node, at) => (
                      <li key={`${node.id}-${at}`} className="flex items-center gap-2 text-xs">
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground">
                          {at + 1}
                        </span>
                        <span className="min-w-0 flex-1 truncate">
                          <span className="text-foreground">{labelFor(node)}</span>{" "}
                          <span className="font-mono text-[11px] text-muted-foreground">
                            {isSubflowNode(node) ? node.workflows.join(", ") : node.moduleId}
                          </span>
                        </span>
                        <button
                          type="button"
                          onClick={() => onChange(withoutSectionNode(list, section.key, at))}
                          className="shrink-0 rounded-md border border-border p-1 text-muted-foreground hover:bg-muted hover:text-destructive"
                          aria-label={t(REMOVE_KEY, "Remove")}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </li>
                    ))}
                  </ol>
                )}

                <div className="mt-auto flex items-center gap-2 pt-3">
                  <select
                    value={nodePicks[section.key] ?? ""}
                    onChange={(event) =>
                      setNodePicks((current) => ({ ...current, [section.key]: event.target.value }))
                    }
                    className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
                  >
                    <option value="">{t("modelBuilder.workflows.editor.pickModule", "Add a module…")}</option>
                    <optgroup label={t("modelBuilder.workflows.editor.palette", "Modules")}>
                      {nodeModules.map((entry) => (
                        <option key={entry.module.id} value={`module:${entry.module.id}`}>
                          {entry.module.name ?? entry.module.id}
                        </option>
                      ))}
                    </optgroup>
                    <optgroup label={t("modelBuilder.workflows.editor.pickWorkflow", "Workflows")}>
                      {workflows.map((workflow) => (
                        <option key={workflow.id} value={`workflow:${workflow.id}`}>
                          {workflow.label}
                        </option>
                      ))}
                    </optgroup>
                  </select>
                  <button
                    type="button"
                    onClick={() => addNode(section)}
                    disabled={(nodePicks[section.key] ?? "") === ""}
                    className={`shrink-0 rounded-md border px-2.5 py-1 text-xs ${
                      (nodePicks[section.key] ?? "") === ""
                        ? "border-border text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-30"
                        : "border-primary bg-primary font-medium text-primary-foreground hover:opacity-90"
                    }`}
                  >
                    {t("modelBuilder.workflows.editor.addNode", "Add node")}
                  </button>
                </div>
              </div>
            </article>
          ))}

          {/* The draft is a card too, so the fields and the Add/Cancel pair sit together where it is
              authored, rather than an Add button flung to the far side of a wide form row. */}
          {suggestionDraft !== null && (
            <article className="flex w-full flex-col gap-2 rounded-lg border border-dashed border-border bg-card p-3 sm:w-[20rem]">
              <label className="block">
                <span className="text-[11px] text-muted-foreground">
                  {t("modelBuilder.workflows.editor.suggestionTitle", "Title")}
                </span>
                <input
                  autoFocus
                  value={suggestionDraft.title}
                  onChange={(event) => setSuggestionDraft({ ...suggestionDraft, title: event.target.value })}
                  className="mt-0.5 w-full rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
                />
              </label>
              <label className="block">
                <span className="text-[11px] text-muted-foreground">
                  {t("modelBuilder.workflows.editor.suggestionWhy", "Why (the goal)")}
                </span>
                <input
                  value={suggestionDraft.why}
                  onChange={(event) => setSuggestionDraft({ ...suggestionDraft, why: event.target.value })}
                  className="mt-0.5 w-full rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
                />
              </label>
              <div className="mt-auto flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setSuggestionDraft(null)}
                  className="rounded-md border border-border px-2.5 py-1 text-xs hover:bg-muted"
                >
                  {t("modelBuilder.workflows.newForm.cancel", "Cancel")}
                </button>
                <button
                  type="button"
                  onClick={addSuggestion}
                  disabled={suggestionDraft.title.trim().length === 0}
                  className="rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-30"
                >
                  {t("modelBuilder.workflows.editor.add", "Add")}
                </button>
              </div>
            </article>
          )}
        </div>

        {suggestionDraft === null && (
          <button
            type="button"
            onClick={() => setSuggestionDraft({ title: "", why: "" })}
            className="mt-3 flex items-center gap-1 rounded-md border border-dashed border-border px-2.5 py-1 text-xs text-foreground hover:bg-muted"
          >
            <Plus className="h-3.5 w-3.5" />
            {t("modelBuilder.workflows.editor.addSuggestion", "Add a suggestion")}
          </button>
        )}
      </div>
    </section>
  );
};
export const WorkflowEditor: React.FC<WorkflowEditorProps> = ({
  document,
  catalogue,
  workflows,
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
  const [picker, setPicker] = useState<{ kind: "append" } | { kind: "change"; index: number } | null>(
    null,
  );

  /** The document with the chain replaced — the editor's own node-list edit, handed back whole. */
  const changeNodes = (nodes: readonly WorkflowNodeDocument[]): void => {
    onChange({ ...document, nodes: [...nodes] });
  };

  /** The document with the recommended list replaced; an empty list drops the field. */
  const changeRecommended = (recommended: RecommendedSection[]): void => {
    const next: WorkflowDocument = { ...document };
    if (recommended.length === 0) delete next.recommended;
    else next.recommended = recommended;
    onChange(next);
  };

  /** Why the document's recommended map is malformed, or `undefined` — surfaced where it is authored. */
  const problem = useMemo(() => documentProblem(document), [document]);

  const byId = useMemo(
    () => new Map(catalogue.map((entry) => [entry.module.id, entry])),
    [catalogue],
  );
  const lookup = useMemo<WorkflowLookup>(() => {
    const byWorkflowId = new Map(workflows.map((workflow) => [workflow.id, workflow]));
    return (workflowId) => byWorkflowId.get(workflowId);
  }, [workflows]);
  const registry = useMemo<ModuleRegistry>(
    () => Object.fromEntries(catalogue.map((entry) => [entry.module.id, entry.module])),
    [catalogue],
  );
  const fragment = document.isSubflow === true;
  const palette = useMemo(
    () => paletteFor(catalogue, document.nodes, lookup, { fragment }),
    [catalogue, document.nodes, lookup, fragment],
  );

  /** What the fragment needs from the flow that inserts it (`fragmentRequiredPorts`); `null` when it cannot be flattened. */
  const fragmentInputs = useMemo(() => {
    if (!fragment) return null;
    try {
      return fragmentRequiredPorts(document, lookup, registry);
    } catch {
      return null;
    }
  }, [fragment, document, lookup, registry]);

  /** The candidates for the open picker, judged against the chain prefix ending where the subflow sits. */
  const candidates = useMemo(() => {
    if (picker === null) return [];
    const prefix = picker.kind === "append" ? document.nodes.length : picker.index;
    const produced = producedPorts(document.nodes.slice(0, prefix), catalogue, lookup);
    return subflowCandidates(workflows, produced, registry, lookup, document.id, { fragment });
  }, [picker, document.nodes, document.id, workflows, catalogue, lookup, registry, fragment]);

  /** Each subflow node's expansion, composed as `expand` does it; `null` when it cannot be walked. */
  const expansions = useMemo(() => {
    const byNode = new Map<string, FlowNode[] | null>();
    for (const node of document.nodes) {
      if (!isSubflowNode(node)) continue;
      try {
        byNode.set(node.id, expand({ ...document, nodes: [node] }, lookup, registry));
      } catch {
        byNode.set(node.id, null);
      }
    }
    return byNode;
  }, [document, lookup, registry]);

  const remove = (index: number): void => {
    changeNodes(removeFrom(document.nodes, index));
    setPendingRemove(null);
  };

  const askRemove = (index: number): void => {
    if (removedCount(document.nodes, index) <= 1) remove(index);
    else setPendingRemove(index);
  };

  /** The verdict for moving one entry a direction; a fragment skips the check (it is judged where inserted). */
  const moveVerdict = (index: number, direction: MoveDirection): MoveVerdict =>
    fragment ? { ok: true } : moveIsAllowed(document, index, direction, lookup, registry);

  const move = (index: number, direction: MoveDirection): void =>
    changeNodes(moveNode(document.nodes, index, direction));

  const choose = (workflowId: string): void => {
    if (picker === null) return;
    changeNodes(
      picker.kind === "append"
        ? appendSubflow(document.nodes, workflowId)
        : chooseSubflowWorkflow(document.nodes, picker.index, workflowId),
    );
    setPicker(null);
  };

  /** A subflow node's row: the bracket around the workflow it brings in, with the control to change it. */
  const renderSubflow = (node: SubflowNodeDocument, index: number): React.ReactNode => {
    const referenced = lookup(node.workflows[0] ?? "");
    const children = expansions.get(node.id) ?? null;
    return (
      <li
        key={node.id}
        className="rounded-lg border-2 border-dashed border-violet-300 bg-violet-50/40 p-3 dark:border-violet-800 dark:bg-violet-950/20"
      >
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-violet-200 text-violet-800 dark:bg-violet-900/50 dark:text-violet-200">
            <Layers className="h-3.5 w-3.5" />
          </span>

          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-2 truncate text-sm font-medium text-foreground">
              {referenced?.label ?? node.workflows[0] ?? node.id}
              <span className="rounded bg-violet-200 px-1.5 py-0.5 text-[11px] font-semibold text-violet-800 dark:bg-violet-900/50 dark:text-violet-200">
                {t("modelBuilder.workflows.editor.subflow", "subflow")}
              </span>
            </p>
            <p className="truncate font-mono text-[11px] text-muted-foreground">
              {node.workflows.join(", ")}
            </p>
            {referenced?.description !== undefined && referenced.description !== "" && (
              <p className="mt-1 text-[11px] text-muted-foreground">{referenced.description}</p>
            )}
          </div>

          <button
            type="button"
            onClick={() => setPicker({ kind: "change", index })}
            className="flex shrink-0 items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted"
          >
            <Repeat className="h-3.5 w-3.5" />
            {t("modelBuilder.workflows.editor.changeWorkflow", "Change workflow")}
          </button>

          <MoveControls
            index={index}
            first={index === 0}
            last={index === document.nodes.length - 1}
            up={moveVerdict(index, "up")}
            down={moveVerdict(index, "down")}
            onMove={move}
          >
            <button
              type="button"
              onClick={() => askRemove(index)}
              className="shrink-0 rounded-md border border-border p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive"
              aria-label={t(REMOVE_KEY, "Remove")}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </MoveControls>
        </div>

        <div className="mt-3 ml-3 border-l-2 border-violet-300 pl-3 dark:border-violet-800">
          <p className="mb-1.5 text-[11px] text-muted-foreground">
            {t(
              "modelBuilder.workflows.editor.subflowOwnedBy",
              "Steps from \"{{label}}\" - edited in that workflow, not here.",
              { label: referenced?.label ?? node.workflows[0] ?? node.id },
            )}
          </p>

          {children === null ? (
            <p className="text-[11px] text-amber-700 dark:text-amber-400">
              {t(
                "modelBuilder.workflows.editor.subflowExpansionFailed",
                "This workflow cannot be expanded here.",
              )}
            </p>
          ) : (
            <ol className="space-y-1.5">
              {children.map((child, at) => (
                <li
                  key={child.id}
                  className="flex items-center gap-2 rounded-md border border-border bg-card/60 px-2 py-1.5 opacity-80"
                >
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground">
                    {at + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-foreground">
                      {child.label ?? child.moduleId}
                    </span>
                    <span className="block truncate font-mono text-[11px] text-muted-foreground">
                      {child.id}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
          )}

          {picker?.kind === "change" && picker.index === index && (
            <div className="mt-3">
              <SubflowPicker
                candidates={candidates}
                current={node.workflows[0] ?? null}
                onChoose={choose}
                onCancel={() => setPicker(null)}
              />
            </div>
          )}
        </div>
      </li>
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
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
          <h2 className="flex items-center gap-2 truncate text-base font-semibold text-foreground">
            {document.label}
            {fragment && (
              <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[11px] font-semibold text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">
                {t("modelBuilder.workflows.editor.fragment", "fragment")}
              </span>
            )}
          </h2>
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

      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-auto p-6">
        <RecommendedPanel
          recommended={document.recommended}
          problem={problem}
          catalogue={catalogue}
          workflows={workflows}
          onChange={changeRecommended}
        />

        {/* shrink-0: without it the scrolling column shrinks this row, and the chain overflows across
            the sections laid out after it. */}
        <div className="flex shrink-0 flex-col gap-6 lg:flex-row">
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
                if (isSubflowNode(node)) return renderSubflow(node, index);

                const entry = byId.get(node.moduleId);
                const problem =
                  entry === undefined
                    ? t(
                        "modelBuilder.workflows.editor.unknownModule",
                        "Unknown module \"{{moduleId}}\" at node \"{{nodeId}}\" - it is not in this build's catalogue.",
                        { moduleId: node.moduleId, nodeId: node.id },
                      )
                    : isHostModule(entry.module)
                      ? t(
                          "modelBuilder.workflows.editor.notANode",
                          "\"{{moduleId}}\" at node \"{{nodeId}}\" is not a node - it is a host module, which provides a service rather than rendering a step.",
                          { moduleId: node.moduleId, nodeId: node.id },
                        )
                      : null;
                return (
                  <li
                    key={node.id}
                    className="flex items-start gap-3 rounded-lg border border-border bg-card p-3"
                  >
                    <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
                      {index + 1}
                    </span>

                    <div className="min-w-0 flex-1">
                      {entry !== undefined && !isHostModule(entry.module) ? (
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
                      ) : (
                        <p className="text-sm text-destructive">{problem}</p>
                      )}
                    </div>

                    <MoveControls
                      index={index}
                      first={index === 0}
                      last={index === document.nodes.length - 1}
                      up={moveVerdict(index, "up")}
                      down={moveVerdict(index, "down")}
                      onMove={move}
                    >
                      <button
                        type="button"
                        onClick={() => askRemove(index)}
                        className="shrink-0 rounded-md border border-border p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive"
                        aria-label={t(REMOVE_KEY, "Remove")}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </MoveControls>
                  </li>
                );
              })}
            </ol>
          )}

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
                  {t(REMOVE_KEY, "Remove")}
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

        <section className="min-w-0 flex-1 lg:max-w-sm">
          <h3 className="mb-2 text-sm font-semibold text-foreground">
            {t("modelBuilder.workflows.editor.palette", "Modules")}
          </h3>
          {fragment ? (
            <FragmentNotice inputs={fragmentInputs} />
          ) : (
            <p className="mb-3 text-xs text-muted-foreground">
              {t(
                "modelBuilder.workflows.editor.gateHint",
                "A module can be added once the chain already produces every port it requires.",
              )}
            </p>
          )}

          <button
            type="button"
            onClick={() => setPicker({ kind: "append" })}
            className="mb-3 flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-muted"
          >
            <Layers className="h-4 w-4" />
            {t("modelBuilder.workflows.editor.addSubflow", "Insert a workflow")}
          </button>

          {picker?.kind === "append" && (
            <div className="mb-3">
              <SubflowPicker
                candidates={candidates}
                current={null}
                onChoose={choose}
                onCancel={() => setPicker(null)}
              />
            </div>
          )}

          <ul className="space-y-2">
            {palette.map((entry) => (
              <PaletteRow
                key={entry.module.module.id}
                entry={entry}
                onAdd={() => changeNodes(appendModule(document.nodes, entry.module))}
              />
            ))}
          </ul>
        </section>
        </div>
      </div>
    </div>
  );
};

export default WorkflowEditor;
