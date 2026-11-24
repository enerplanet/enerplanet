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
  renamedTerminal,
  updatedSection,
  withSection,
  withSectionNode,
  withTerminal,
  withoutSection,
  withoutSectionNode,
  withoutTerminal,
  type RecommendedMap,
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

/** Recommended sections, authored: the map keyed by a terminal node's **stable name**. */
const RecommendedPanel: React.FC<{
  recommended: RecommendedMap | undefined;
  problem: string | undefined;
  catalogue: readonly BuilderModule[];
  onChange: (recommended: RecommendedMap) => void;
}> = ({ recommended, problem, catalogue, onChange }) => {
  const { t } = useTranslation();
  const [terminalDraft, setTerminalDraft] = useState("");
  const [sectionDraft, setSectionDraft] = useState<{
    terminal: string;
    key: string;
    label: string;
    description: string;
  } | null>(null);
  const [nodePicks, setNodePicks] = useState<Record<string, string>>({});
  /** Folded until the author opens it, so the panel stays out of the way by default. */
  const [open, setOpen] = useState(false);

  const map = recommended ?? {};
  const terminals = Object.keys(map);
  const nodeModules = catalogue.filter((entry) => !isHostModule(entry.module));

  const addTerminal = (): void => {
    const name = terminalDraft.trim();
    if (name.length === 0) return;
    onChange(withTerminal(map, name));
    setTerminalDraft("");
  };

  const addSection = (): void => {
    if (sectionDraft === null) return;
    const key = sectionDraft.key.trim();
    if (key.length === 0) return;
    onChange(
      withSection(map, sectionDraft.terminal, {
        key,
        label: sectionDraft.label,
        description: sectionDraft.description,
        nodes: [],
      }),
    );
    setSectionDraft(null);
  };

  const addNode = (terminal: string, section: RecommendedSection): void => {
    const pick = nodePicks[`${terminal}::${section.key}`] ?? "";
    const module = nodeModules.find((entry) => entry.module.id === pick);
    if (module === undefined) return;
    onChange(withSectionNode(map, terminal, section.key, recommendedNode(module, section.nodes)));
    setNodePicks((current) => ({ ...current, [`${terminal}::${section.key}`]: "" }));
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
          {t("modelBuilder.workflows.editor.recommended", "Recommended sections")}
        </span>
      </button>

      {/* Shown open or folded: folding it away must not hide the fault a save refuses on. */}
      {problem !== undefined && (
        <p className="mx-3 mb-3 flex items-start gap-1.5 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {t("modelBuilder.workflows.editor.recommendedProblem", "The recommended sections are malformed: {{reason}}", {
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
              "modelBuilder.workflows.editor.recommendedHint",
              "Follow-up nodes offered after a run, keyed by the terminal node's stable name. Each section is appended as one unit.",
            )}
          </p>

        {terminals.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
            {t("modelBuilder.workflows.editor.recommendedEmpty", "No recommended sections. Name a terminal to begin.")}
          </p>
        ) : (
          <ul className="space-y-3">
            {terminals.map((terminal) => (
              <li key={terminal} className="rounded-lg border border-border bg-card p-3">
                <div className="flex items-start gap-2">
                  <label className="min-w-0 flex-1">
                    <span className="text-[11px] text-muted-foreground">
                      {t("modelBuilder.workflows.editor.terminalName", "Terminal node (stable name)")}
                    </span>
                    <input
                      defaultValue={terminal}
                      onBlur={(event) => {
                        const to = event.target.value.trim();
                        if (to !== terminal) onChange(renamedTerminal(map, terminal, to));
                      }}
                      className="mt-0.5 w-full rounded-md border border-border bg-background px-2 py-1 font-mono text-xs text-foreground"
                    />
                  </label>

                  <button
                    type="button"
                    onClick={() => onChange(withoutTerminal(map, terminal))}
                    className="mt-4 shrink-0 rounded-md border border-border p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive"
                    aria-label={t(REMOVE_KEY, "Remove")}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>

                {(map[terminal] ?? []).length === 0 ? (
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    {t("modelBuilder.workflows.editor.noSections", "No sections yet.")}
                  </p>
                ) : (
                  <ul className="mt-2 space-y-2">
                    {(map[terminal] ?? []).map((section) => (
                      <li key={section.key} className="rounded-md border border-border bg-background p-2.5">
                        <div className="flex items-start gap-2">
                          <div className="min-w-0 flex-1 space-y-1">
                            <label className="block">
                              <span className="text-[11px] text-muted-foreground">
                                {t("modelBuilder.workflows.editor.sectionKey", "Key")}
                              </span>
                              <input
                                defaultValue={section.key}
                                onBlur={(event) =>
                                  onChange(
                                    updatedSection(map, terminal, section.key, { key: event.target.value.trim() }),
                                  )
                                }
                                className="mt-0.5 w-full rounded-md border border-border bg-background px-2 py-1 font-mono text-xs text-foreground"
                              />
                            </label>
                            <label className="block">
                              <span className="text-[11px] text-muted-foreground">
                                {t("modelBuilder.workflows.editor.sectionLabel", "Label")}
                              </span>
                              <input
                                defaultValue={section.label}
                                onBlur={(event) =>
                                  onChange(updatedSection(map, terminal, section.key, { label: event.target.value }))
                                }
                                className="mt-0.5 w-full rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
                              />
                            </label>
                            <label className="block">
                              <span className="text-[11px] text-muted-foreground">
                                {t("modelBuilder.workflows.editor.sectionDescription", "Description (the goal)")}
                              </span>
                              <input
                                defaultValue={section.description}
                                onBlur={(event) =>
                                  onChange(
                                    updatedSection(map, terminal, section.key, { description: event.target.value }),
                                  )
                                }
                                className="mt-0.5 w-full rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
                              />
                            </label>
                          </div>

                          <button
                            type="button"
                            onClick={() => onChange(withoutSection(map, terminal, section.key))}
                            className="shrink-0 rounded-md border border-border p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive"
                            aria-label={t(REMOVE_KEY, "Remove")}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>

                        <div className="mt-2 border-t border-border pt-2">
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
                                    <span className="text-foreground">{node.label ?? node.id}</span>{" "}
                                    <span className="font-mono text-[11px] text-muted-foreground">
                                      {isSubflowNode(node) ? node.workflows.join(", ") : node.moduleId}
                                    </span>
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => onChange(withoutSectionNode(map, terminal, section.key, at))}
                                    className="shrink-0 rounded-md border border-border p-1 text-muted-foreground hover:bg-muted hover:text-destructive"
                                    aria-label={t(REMOVE_KEY, "Remove")}
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                </li>
                              ))}
                            </ol>
                          )}

                          <div className="mt-2 flex items-center gap-2">
                            <select
                              value={nodePicks[`${terminal}::${section.key}`] ?? ""}
                              onChange={(event) =>
                                setNodePicks((current) => ({
                                  ...current,
                                  [`${terminal}::${section.key}`]: event.target.value,
                                }))
                              }
                              className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
                            >
                              <option value="">{t("modelBuilder.workflows.editor.pickModule", "Add a module…")}</option>
                              {nodeModules.map((entry) => (
                                <option key={entry.module.id} value={entry.module.id}>
                                  {entry.module.name ?? entry.module.id}
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              onClick={() => addNode(terminal, section)}
                              disabled={(nodePicks[`${terminal}::${section.key}`] ?? "") === ""}
                              className="shrink-0 rounded-md border border-border px-2.5 py-1 text-xs text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-30"
                            >
                              {t("modelBuilder.workflows.editor.addNode", "Add node")}
                            </button>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}

                {sectionDraft !== null && sectionDraft.terminal === terminal ? (
                  <div className="mt-2 rounded-md border border-dashed border-border p-2.5">
                    <div className="flex flex-wrap items-end gap-2">
                      <label className="flex flex-col gap-1 text-[11px] font-medium text-muted-foreground">
                        {t("modelBuilder.workflows.editor.sectionKey", "Key")}
                        <input
                          autoFocus
                          value={sectionDraft.key}
                          onChange={(event) => setSectionDraft({ ...sectionDraft, key: event.target.value })}
                          className="w-32 rounded-md border border-border bg-background px-2 py-1 font-mono text-xs text-foreground"
                        />
                      </label>
                      <label className="flex flex-1 flex-col gap-1 text-[11px] font-medium text-muted-foreground">
                        {t("modelBuilder.workflows.editor.sectionLabel", "Label")}
                        <input
                          value={sectionDraft.label}
                          onChange={(event) => setSectionDraft({ ...sectionDraft, label: event.target.value })}
                          className="w-full rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
                        />
                      </label>
                      <button
                        type="button"
                        onClick={addSection}
                        disabled={sectionDraft.key.trim().length === 0}
                        className="rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-30"
                      >
                        {t("modelBuilder.workflows.editor.add", "Add")}
                      </button>
                      <button
                        type="button"
                        onClick={() => setSectionDraft(null)}
                        className="rounded-md border border-border px-2.5 py-1 text-xs hover:bg-muted"
                      >
                        {t("modelBuilder.workflows.newForm.cancel", "Cancel")}
                      </button>
                    </div>
                    <input
                      value={sectionDraft.description}
                      onChange={(event) => setSectionDraft({ ...sectionDraft, description: event.target.value })}
                      placeholder={t("modelBuilder.workflows.editor.sectionDescription", "Description (the goal)")}
                      className="mt-2 w-full rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
                    />
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setSectionDraft({ terminal, key: "", label: "", description: "" })}
                    className="mt-2 flex items-center gap-1 rounded-md border border-dashed border-border px-2.5 py-1 text-xs text-foreground hover:bg-muted"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    {t("modelBuilder.workflows.editor.addSection", "Add section")}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        <div className="mt-3 flex items-end gap-2">
          <label className="flex flex-1 flex-col gap-1 text-[11px] font-medium text-muted-foreground">
            {t("modelBuilder.workflows.editor.addTerminal", "Add a terminal")}
            <input
              value={terminalDraft}
              onChange={(event) => setTerminalDraft(event.target.value)}
              placeholder="model-start"
              className="w-full rounded-md border border-border bg-background px-2 py-1 font-mono text-xs text-foreground"
            />
          </label>
          <button
            type="button"
            onClick={addTerminal}
            className="flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:opacity-90"
          >
            <Plus className="h-3.5 w-3.5" />
            {t("modelBuilder.workflows.editor.add", "Add")}
          </button>
        </div>
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

  /** The document with the recommended map replaced; an empty map drops the field. */
  const changeRecommended = (recommended: RecommendedMap): void => {
    const next: WorkflowDocument = { ...document };
    if (Object.keys(recommended).length === 0) delete next.recommended;
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
