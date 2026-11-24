/**
 * The workflow editor — a linear chain, and the palette that gates what may be appended.
 *
 * The chain is the document's `nodes`, in order. Appending offers a module only once every `required` port
 * it declares is produced by the chain so far; the palette lists the whole catalogue and greys what cannot
 * go next, naming the port it waits for. **The gate is editor-level guidance, not a core invariant** — a
 * module may declare a port it never writes, so the engine, not this palette, decides whether a node runs
 * (`gate.ts` carries the full caveat).
 *
 * A **subflow** is not a module, so it is not a row in the palette: its own control opens a picker
 * (`subflowCandidates`) listing every stored workflow judged for this position. Choosing one appends a
 * subflow node, which renders as a **bracket** around the expansion of the workflow it references — the
 * nodes that workflow brings in, shown as belonging to it and not editable here. The bracket names that
 * workflow and carries a control to change it (the same picker, pre-set, appending nothing). A node's list
 * of candidates may hold several; this renders the first, and the per-candidate tabs attach inside the
 * bracket (see `renderSubflow`).
 *
 * Removing an entry drops it and everything after it: a linear chain cannot have a hole, and the confirm
 * says so. Unsaved changes are shown in the header.
 */

import { useMemo, useState } from "react";
import { useTranslation } from "@spatialhub/i18n";
import { ArrowDown, ArrowLeft, ArrowUp, Layers, Plus, Repeat, Save, Trash2, TriangleAlert } from "lucide-react";
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
  /**
   * Every stored workflow **with its document** — the candidates a subflow picker offers and the documents a
   * subflow node's expansion resolves through (`WorkflowLookup`). The page passes the list it already holds;
   * the workflow being edited is left in it, since `subflowVerdict` refuses it as `recursive`.
   */
  workflows: readonly WorkflowDocument[];
  /** Whether the server already has a row for this document (create vs. update on save). */
  persisted: boolean;
  dirty: boolean;
  saving: boolean;
  error: string | null;
  /**
   * The document as edited. The editor authors the chain **and** the `recommended` map, so it hands back
   * the whole document rather than the node list alone: the page keeps a `recommended` edit the same way it
   * keeps a chain edit. Everything the editor does not author (`seed`, the key order of the stored document) is
   * carried through unchanged, exactly as `documentWithNodes` does for the node list.
   */
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

/**
 * The up/down controls for one chain entry, with the reason a direction is refused.
 *
 * Movement is buttons rather than drag: the editor is rendered and tested in a **node** environment with no
 * DOM, so a drag could not be exercised here. A direction that cannot take effect — the ends have no
 * neighbour, or the move would add an unmet requirement — is rendered **disabled**, never hidden: a control
 * that vanishes reads as a bug, and the palette already states its refusals in place. A boundary needs no
 * explanation; a move the data flow refuses names the ports it would leave unmet, because that is the fact
 * the user can act on.
 *
 * `children` is the row's other controls (the remove button), so the three sit in one cluster exactly as the
 * remove control did alone.
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

  /** The refusal for a direction that is blocked by the data flow, not merely by the chain's end. */
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
      {/* A boundary is disabled by position, not by the data flow, so it shows no port refusal. */}
      {!first && refusal(up)}
      {!last && refusal(down)}
    </div>
  );
};

/**
 * The fragment notice: a fragment is validated where it is inserted, so the gate is off here — stated as a
 * warning panel rather than the palette's muted hint, because an off safety net should not read as a footnote.
 *
 * Beneath the warning, the ports the fragment will need from the flow around it: the union of its modules'
 * unmet `required` ports, read by the same positional walk a candidate's verdict uses (`unmetRequiredPorts`
 * via `fragmentRequiredPorts`) with an empty prefix. `inputs === null` means the fragment could not be
 * flattened, so there is nothing to name — the chain reports that per node, and the panel stays silent rather
 * than duplicating it. An empty list is a real, good state and is said plainly instead of shown as an empty box.
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

/**
 * The subflow picker: every stored workflow, its label and description, and the verdict as a row state.
 *
 * An `ok` verdict leaves the row selectable; `missing`, `recursive` and `unresolved` grey it and name the
 * reason. `missing` names the ports the chain prefix has not produced, in the same chip as the palette; the
 * other two are a single sentence, because they name a whole-document defect rather than a port. `current`
 * marks the candidate a "change" was opened from; it is not a second filter — a candidate the verdict
 * refuses stays refused whether or not it is current.
 */
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

                  {/* The refusal says why, rather than only that it is refused. */}
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

/**
 * Recommended sections, authored. The map is keyed by a terminal node's **stable name** — a module's
 * `moduleId`, or a seed node's own `id` — so a terminal is named first and its sections authored under it.
 * Each section carries its own workflow-local `key`, a `label`, a `description` (the goal), and the module
 * nodes appended as one unit when the section is taken.
 *
 * Every edit is a pure `recommendedEdit` call: the panel renders the map it is handed and hands the new one
 * back through `onChange`, so the page and the validator see exactly what the user typed — a malformed map is
 * reported by `problem` (below the panel) rather than silently corrected here.
 */
const RecommendedPanel: React.FC<{
  recommended: RecommendedMap | undefined;
  problem: string | undefined;
  catalogue: readonly BuilderModule[];
  onChange: (recommended: RecommendedMap) => void;
}> = ({ recommended, problem, catalogue, onChange }) => {
  const { t } = useTranslation();
  const [terminalDraft, setTerminalDraft] = useState("");
  /** The section being authored for a terminal, or `null` when no add-section form is open. */
  const [sectionDraft, setSectionDraft] = useState<{
    terminal: string;
    key: string;
    label: string;
    description: string;
  } | null>(null);
  /** The module selected for each section's node picker, keyed by `terminal::key`. */
  const [nodePicks, setNodePicks] = useState<Record<string, string>>({});

  const map = recommended ?? {};
  const terminals = Object.keys(map);
  // Only node modules can be a section's node — a host module is not a step (see `paletteFor`).
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
    <section>
      <h3 className="mb-2 text-sm font-semibold text-foreground">
        {t("modelBuilder.workflows.editor.recommended", "Recommended sections")}
      </h3>
      <p className="mb-3 text-xs text-muted-foreground">
        {t(
          "modelBuilder.workflows.editor.recommendedHint",
          "Follow-up nodes offered after a run, keyed by the terminal node's stable name. Each section is appended as one unit.",
        )}
      </p>

      {/* A malformed map is reported here, before a save is attempted — the same rule the save refuses on. */}
      {problem !== undefined && (
        <p className="mb-3 flex items-start gap-1.5 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {t("modelBuilder.workflows.editor.recommendedProblem", "The recommended sections are malformed: {{reason}}", {
              reason: problem,
            })}
          </span>
        </p>
      )}

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

                      {/* The nodes appended as one unit when the section is taken. */}
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

      {/* Name a terminal the map does not carry yet — the stable name a section is offered under. */}
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
  /** Which picker is open: appending at the end, or changing the subflow node at `index`. */
  const [picker, setPicker] = useState<{ kind: "append" } | { kind: "change"; index: number } | null>(
    null,
  );

  /** The document with the chain replaced — the editor's own node-list edit, handed back whole. */
  const changeNodes = (nodes: readonly WorkflowNodeDocument[]): void => {
    onChange({ ...document, nodes: [...nodes] });
  };

  /**
   * The document with the recommended map replaced. An emptied map drops the field entirely rather than leaving
   * `recommended: {}` behind, so a workflow that offers no follow-ups reads as one that never did.
   */
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
  // The documents a subflow node's expansion resolves through, keyed by the id a subflow references — the same
  // shape `expand` takes, built once from the workflow list the page already holds.
  const lookup = useMemo<WorkflowLookup>(() => {
    const byWorkflowId = new Map(workflows.map((workflow) => [workflow.id, workflow]));
    return (workflowId) => byWorkflowId.get(workflowId);
  }, [workflows]);
  // The registry `subflowVerdict` flattens a candidate through — the catalogue's modules by id.
  const registry = useMemo<ModuleRegistry>(
    () => Object.fromEntries(catalogue.map((entry) => [entry.module.id, entry.module])),
    [catalogue],
  );
  // A fragment is authored to be spliced into another flow, so its own prefix is not the test for what it may
  // contain: the palette offers every module and the picker drops the positional `missing` verdict. A flow is
  // gated as before (`GateOptions`).
  const fragment = document.isSubflow === true;
  const palette = useMemo(
    () => paletteFor(catalogue, document.nodes, lookup, { fragment }),
    [catalogue, document.nodes, lookup, fragment],
  );

  /**
   * What the fragment will need from the flow that inserts it: its own expansion read with an empty prefix
   * (`fragmentRequiredPorts`). `null` when the fragment cannot be flattened — an unresolved subflow or a
   * module this build lacks, which the chain reports per node, so the notice adds nothing to say.
   */
  const fragmentInputs = useMemo(() => {
    if (!fragment) return null;
    try {
      return fragmentRequiredPorts(document, lookup, registry);
    } catch {
      return null;
    }
  }, [fragment, document, lookup, registry]);

  /**
   * The candidates for the open picker, judged against the chain prefix that ends where the subflow sits:
   * the whole chain for an append, the nodes before it for a change.
   */
  const candidates = useMemo(() => {
    if (picker === null) return [];
    const prefix = picker.kind === "append" ? document.nodes.length : picker.index;
    const produced = producedPorts(document.nodes.slice(0, prefix), catalogue, lookup);
    return subflowCandidates(workflows, produced, registry, lookup, document.id, { fragment });
  }, [picker, document.nodes, document.id, workflows, catalogue, lookup, registry, fragment]);

  /**
   * Each subflow node's expansion: the referenced workflow's module nodes, ids namespaced by the node and
   * labels prefixed with it, exactly as `expand` composes them inside this document. Read per node — a
   * one-node document holding just that node — so a defect inside one subflow does not blank the others.
   * `null` when the expansion cannot be walked (an unresolved reference, a module this build lacks).
   */
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
    // The last entry drops nothing but itself, so there is no consequence to confirm. Anything earlier
    // takes its dependents with it, and that is what the confirm states.
    if (removedCount(document.nodes, index) <= 1) remove(index);
    else setPendingRemove(index);
  };

  /**
   * The verdict for moving one entry a direction. A fragment is judged where it is inserted, so no move can
   * break its own (empty-prefix) flow: the check is skipped entirely here — the same relaxation the palette
   * has for a fragment (`GateOptions`), applied to movement.
   */
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

        {/* The bracket proper: the nodes this workflow contributes, marked as belonging to it and read-only
            here — they live in that document, and that is where they are edited. */}
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

          {/* A node's candidate list may hold several workflows; this renders the first (`expand`'s default
              `choose`). The per-candidate tabs attach here, selecting which one this bracket shows. */}
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
          <h2 className="flex items-center gap-2 truncate text-base font-semibold text-foreground">
            {document.label}
            {/* Visible so an ungated palette, and a refused run, read as authored rather than as a bug. */}
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
        <div className="flex min-h-0 flex-col gap-6 lg:flex-row">
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
                // A subflow node is not a module — it references a workflow to splice in here, so it renders
                // as the bracket around that workflow's expansion rather than as an ordinary chain row.
                if (isSubflowNode(node)) return renderSubflow(node, index);

                const entry = byId.get(node.moduleId);
                // Two ways a stored node can name something that is not a step this build can run. Both are
                // data conditions to report — naming the node and the module — rather than exceptions that
                // take the surface down: a module the catalogue no longer declares, and a host
                // module, which is in the catalogue but was never a node.
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

        {/* The palette — the whole catalogue, gated — and, above it, the subflow's own control. */}
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

          {/* A subflow is not a module, so it does not sit in the list below: its own control opens the
              picker, which appends nothing until a workflow is chosen. */}
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

        <RecommendedPanel
          recommended={document.recommended}
          problem={problem}
          catalogue={catalogue}
          onChange={changeRecommended}
        />
      </div>
    </div>
  );
};

export default WorkflowEditor;
