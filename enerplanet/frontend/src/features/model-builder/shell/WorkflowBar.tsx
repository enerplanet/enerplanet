/**
 * The workflow bar — the frame's top band.
 *
 * Dense by rule: it is chrome, and vertical space belongs to the content.
 *
 * **The bar moves; it does not undo.** Movement is a **view**: a prior click sets the placement the
 * session is looking at and writes **nothing** (§4) — no `jump` commit, no redo tail — so the moved-to
 * node stays `done`, not stale. There is no `undo`/`redo` here at all: the bar is not a history control.
 * What goes stale is decided by *influence* when a node actually runs, never by where the bar looked.
 *
 * So the **prior step is the one backward control**, and it is a control only when there is a node behind the
 * session to return to. The **next step is plain greyed text**: it names what comes next rather than moving
 * there. There is **no forward control at all** — an interactive module advances by running itself (its own
 * Apply), and an auto node runs on arrival with no button anywhere (`autoRun.ts`), so a bar button whose
 * enabled-ness depended on node state would be the frame pretending to know something only the session knows.
 *
 * Moving to *any* step behind the frontier is now offered: a view writes nothing, so there is no preview to
 * owe. The one rule that remains is direction — a view reaches only backwards, because forward is *running*
 * the node, and a later node is reached that way rather than by standing on it.
 *
 * In **test mode** there is no position to show, so it says so rather than rendering a bar of dashes — a bar
 * naming steps while no workflow drives the session would be lying about where it is. The movement and save
 * controls are hidden for the same reason: there is no position to move and no session to save.
 *
 * Everything it renders in workflow mode comes from `barState`, so the bar holds no knowledge of history that
 * could fall out of date. Movement is not reimplemented here either — the prior control calls `actions.ts`
 * directly, which is exactly the thinness the bar wants.
 */

import { Save } from "lucide-react";
import { useTranslation } from "@spatialhub/i18n";
import { barState, type BarStep } from "./barState";
import type { FrameMode } from "./frameMode";
import type { Workflow } from "./workflow";
import type { Flow } from "../core/flow";
import type { Store } from "../core/store";

/** Semantic theme pairs rather than raw hues, so the states read correctly in dark mode too. */
const STATE_CLASS: Record<BarStep["state"], string> = {
  done: "text-emerald-600 dark:text-emerald-400",
  stale: "text-amber-600 dark:text-amber-400",
  pending: "text-muted-foreground",
};

/**
 * One framed step: the role, and the node filling it.
 *
 * A step renders as a *control* only when clicking it can move the session; without an action it is plain
 * greyed text, which is the honest rendering — a disabled button still looks like something you are being kept
 * from, and the next step usually is not that.
 */
const Step: React.FC<{
  label: string;
  step: BarStep | undefined;
  onClick?: () => void;
}> = ({ label, step, onClick }) => {
  const content = (
    <>
      <span className="text-[0.7rem] uppercase tracking-wide text-muted-foreground/70">{label}</span>
      {step === undefined ? (
        <span className="text-sm text-muted-foreground/70">—</span>
      ) : (
        <span className={`text-sm font-medium ${STATE_CLASS[step.state]}`}>{step.label}</span>
      )}
    </>
  );

  if (onClick === undefined) {
    return <span className="flex items-baseline gap-1.5">{content}</span>;
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className="-mx-1 flex items-baseline gap-1.5 rounded px-1 hover:bg-muted"
    >
      {content}
    </button>
  );
};

interface Props {
  workflow: Workflow;
  /** The effective flow the bar walks — the session's transcript, so an appended placement is a step like any. */
  flow: Flow;
  store: Store;
  mode: FrameMode;
  /** The module ids a developer can point the frame at in test mode. */
  moduleIds: readonly string[];
  onModeChange?: (mode: FrameMode) => void;
  onReset?: () => void;
  /** The session save. The bar owns chrome, the shell owns I/O — so this is a prop, not a call from here. */
  onSave?: () => void;
  saving?: boolean;
  /** What the last save did, shown beside the button. A failed save goes to the frame's error strip. */
  saveNotice?: string;
  /**
   * The placement the session is looking at (§4). The bar derives its position from the store, so without this
   * it would name the frontier while the session is looking elsewhere — and during a run the shell holds it on
   * the node leaving the screen, so the bar does not name the node the session has *reached* while the frame
   * still shows the one it is leaving.
   */
  hold?: string;
  /**
   * Move the view to a placement behind it — the shell's session state, which writes nothing (§4). The prior
   * control is offered only when this is given.
   */
  onMove?: (nodeId: string) => void;
}

export const WorkflowBar: React.FC<Props> = ({
  workflow,
  flow,
  store,
  mode,
  moduleIds,
  onModeChange,
  onReset,
  onSave,
  saving,
  saveNotice,
  hold,
  onMove,
}) => {
  const { t } = useTranslation();
  const bar = barState(flow, workflow.registry, store, hold);

  // Read the discriminant once, as a value: the chip, the select's value and its options all need it, and a
  // boolean alias would have to re-narrow the union at every use.
  const testModuleId = mode.kind === "test" ? mode.moduleId : undefined;
  const drives = testModuleId === undefined;

  return (
    <header className="flex shrink-0 flex-wrap items-center justify-between gap-4 border-b border-border bg-card px-4 py-2">
      <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1">
        <span className="truncate text-sm font-semibold">{workflow.label}</span>

        {drives ? (
          <>
            <nav className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
              {/* Prior: the one backward control, and only when there is a node behind to return to. */}
              <Step
                label={t("modelBuilder.bar.prior")}
                step={bar.prior}
                {...(bar.prior === undefined || onMove === undefined
                  ? {}
                  : { onClick: () => onMove(bar.prior!.id) })}
              />
              <Step label={t("modelBuilder.bar.current")} step={bar.current} />
              {/* Next: always plain text — there is no forward control; a module advances by running itself. */}
              <Step label={t("modelBuilder.bar.next")} step={bar.next} />
            </nav>

            {bar.complete && (
              <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                {t("modelBuilder.bar.complete")}
              </span>
            )}
          </>
        ) : (
          <span className="rounded-full bg-sky-500/10 px-2 py-0.5 text-xs font-medium text-sky-700 dark:text-sky-400">
            {t("modelBuilder.bar.testMode")} · {testModuleId}
          </span>
        )}
      </div>

      <div className="flex items-center gap-2">
        {drives && (
          <>
            {onSave !== undefined && (
              <button
                type="button"
                onClick={onSave}
                disabled={saving === true}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Save className="h-3.5 w-3.5" />
                {t("modelBuilder.bar.save")}
              </button>
            )}

            {saveNotice !== undefined && (
              <span className="text-xs text-muted-foreground">{saveNotice}</span>
            )}
          </>
        )}

        {import.meta.env.DEV && onModeChange !== undefined && (
          <>
            <label className="text-xs text-muted-foreground" htmlFor="builder-mode">
              {t("modelBuilder.shell.mode")}
            </label>
            <select
              id="builder-mode"
              value={testModuleId ?? "workflow"}
              onChange={(event) => {
                const next = event.target.value;
                onModeChange(next === "workflow" ? { kind: "workflow" } : { kind: "test", moduleId: next });
              }}
              className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs"
            >
              <option value="workflow">{t("modelBuilder.shell.modeWorkflow")}</option>
              {moduleIds.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
          </>
        )}

        {import.meta.env.DEV && onReset !== undefined && (
          <button
            type="button"
            onClick={onReset}
            className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            {t("modelBuilder.shell.reset")}
          </button>
        )}
      </div>
    </header>
  );
};

export default WorkflowBar;
