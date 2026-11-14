/**
 * The workflow bar — the frame's top band (`spec/frame.md` §2, §3.1).
 *
 * Dense by rule: it is chrome, and vertical space belongs to the content.
 *
 * It carries **two kinds of movement, and they are deliberately not the same gesture** (§3.1):
 * - `undo` / `redo` are *atomic* — but atomic means what the store says it means: it steps the cursor to the
 *   previous **interactive boundary**, unwinding a `per-commit` module one action at a time and an
 *   `at-completion` module whole, because undo skips `auto` nodes while it unwinds. The store owns that
 *   decision; the bar does not restate it.
 * - the **prior and next steps are module-wide undo and redo**: a prior click unwinds every commit the nodes in
 *   between own in one gesture, which leaves the redo tail that the next step then walks back to the tip. Step
 *   back to look at something, forward to return exactly where you were.
 *
 * So the forward step is a **control only when there is a tail to walk** (`store.canRedo`) — until then the
 * next step is plain greyed text, which is what it is: information about what comes next rather than something
 * you are being kept from. The same holds for the prior step, which is a control only when there is a prior to
 * return to.
 *
 * Jumping to *any* step is deferred (`optionals.md`): it would make every step a potential jump, and a jump
 * deserves the discard preview it ought to show before it commits.
 *
 * In **test mode** there is no position to show, so it says so rather than rendering a bar of dashes — a bar
 * naming steps while no workflow drives the session would be lying about where it is. The movement and save
 * controls are hidden for the same reason: there is no position to move and no session to save.
 *
 * Everything it renders in workflow mode comes from `barState`, so the bar holds no knowledge of history that
 * could fall out of date. Movement is not reimplemented here either — the controls call the core and
 * `actions.ts` directly, which is exactly the thinness §3.1 asks for.
 */

import { Redo2, Save, Undo2 } from "lucide-react";
import { useTranslation } from "@spatialhub/i18n";
import { barState, type BarStep } from "./barState";
import { redoToTip, undoToNode } from "./actions";
import type { FrameMode } from "./frameMode";
import type { Workflow } from "./workflow";
import type { Store } from "../core/store";

/** Semantic theme pairs rather than raw hues, so the states read correctly in dark mode too. */
const STATE_CLASS: Record<BarStep["state"], string> = {
  done: "text-emerald-600 dark:text-emerald-400",
  stale: "text-amber-600 dark:text-amber-400",
  pending: "text-muted-foreground",
};

const ICON_BUTTON =
  "rounded-lg border border-border p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent";

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
}

export const WorkflowBar: React.FC<Props> = ({
  workflow,
  store,
  mode,
  moduleIds,
  onModeChange,
  onReset,
  onSave,
  saving,
  saveNotice,
}) => {
  const { t } = useTranslation();
  const bar = barState(workflow.flow, workflow.registry, store);

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
              {/* Prior: a control only when there is somewhere to go back to — a module-wide undo. */}
              <Step
                label={t("modelBuilder.bar.prior")}
                step={bar.prior}
                {...(bar.prior === undefined
                  ? {}
                  : {
                      onClick: () =>
                        undoToNode(workflow.flow, workflow.registry, store, bar.prior!.id),
                    })}
              />
              <Step label={t("modelBuilder.bar.current")} step={bar.current} />
              {/* Next: a control only when a redo tail exists — otherwise plain text about what comes next. */}
              <Step
                label={t("modelBuilder.bar.next")}
                step={bar.next}
                {...(store.canRedo ? { onClick: () => redoToTip(store) } : {})}
              />
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
            <button
              type="button"
              onClick={() => store.undo()}
              disabled={!store.canUndo}
              aria-label={t("modelBuilder.bar.undo")}
              title={t("modelBuilder.bar.undo")}
              className={ICON_BUTTON}
            >
              <Undo2 className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => store.redo()}
              disabled={!store.canRedo}
              aria-label={t("modelBuilder.bar.redo")}
              title={t("modelBuilder.bar.redo")}
              className={ICON_BUTTON}
            >
              <Redo2 className="h-4 w-4" />
            </button>

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
