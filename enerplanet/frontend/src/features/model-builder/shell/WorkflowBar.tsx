/**
 * The workflow bar — the frame's top band (`spec/frame.md` §2, §3.1; `spec/core.md` §G).
 *
 * Dense by rule: it is chrome, and vertical space belongs to the content.
 *
 * **The bar moves; it does not undo** (`spec/core.md` §G, superseding §3.1's "module movement is undo/redo").
 * Movement is a **pure position move**: a prior click seals a `jump` with an empty cascade, so it re-arms the
 * node it lands on and discards nothing. There is no `undo`/`redo` here — undo would leave a redo tail, and a
 * move must leave none, so the bar offers no history navigation at all. What goes stale is decided by
 * *influence* when a node actually runs, never by how far the bar moved.
 *
 * So the **prior step is the one backward control**, and it is a control only when there is a node behind the
 * session to return to. The **next step is plain greyed text**: it names what comes next rather than moving
 * there — forward motion is `Continue`, which runs the node the session sits on.
 *
 * Jumping to *any* step is deferred (`optionals.md`): it would make every step a potential jump, and a jump
 * deserves the discard preview it ought to show before it commits.
 *
 * In **test mode** there is no position to show, so it says so rather than rendering a bar of dashes — a bar
 * naming steps while no workflow drives the session would be lying about where it is. The movement and save
 * controls are hidden for the same reason: there is no position to move and no session to save.
 *
 * Everything it renders in workflow mode comes from `barState`, so the bar holds no knowledge of history that
 * could fall out of date. Movement is not reimplemented here either — the prior control calls `actions.ts`
 * directly, which is exactly the thinness §3.1 asks for.
 */

import { Save } from "lucide-react";
import { useTranslation } from "@spatialhub/i18n";
import { barState, type BarStep } from "./barState";
import { moveToNode } from "./actions";
import type { FrameMode } from "./frameMode";
import type { Workflow } from "./workflow";
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
  /** The one forward action: run what the session sits on, walking through auto nodes. */
  onContinue?: () => void;
  continuing?: boolean;
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
  onContinue,
  continuing,
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
              {/* Prior: the one backward control, and only when there is a node behind to return to. */}
              <Step
                label={t("modelBuilder.bar.prior")}
                step={bar.prior}
                {...(bar.prior === undefined
                  ? {}
                  : {
                      onClick: () =>
                        moveToNode(workflow.flow, workflow.registry, store, bar.prior!.id),
                    })}
              />
              <Step label={t("modelBuilder.bar.current")} step={bar.current} />
              {/* Next: always plain text — forward motion is the Continue button, which runs the node. */}
              <Step label={t("modelBuilder.bar.next")} step={bar.next} />
            </nav>

            {/* The one forward action: run what the session sits on, and keep going through auto nodes. */}
            {onContinue !== undefined && !bar.complete && (
              <button
                type="button"
                onClick={onContinue}
                disabled={continuing === true}
                className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {continuing === true ? t("modelBuilder.bar.continuing") : t("modelBuilder.bar.continue")}
              </button>
            )}

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
