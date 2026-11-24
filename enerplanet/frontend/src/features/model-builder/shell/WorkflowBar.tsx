/**
 * The workflow bar — the frame's top band. Dense by rule: it is chrome.
 *
 * The bar moves (a view that writes nothing) and saves; there is no forward control — an interactive
 * module advances by running itself and an auto node runs on arrival. Everything it renders in workflow
 * mode comes from `barState`.
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

/** One framed step: the role, and the node filling it. */
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
  /** The effective flow the bar walks — the session's transcript. */
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
  /** The placement the session is looking at; during a run the shell holds it on the node leaving the screen. */
  hold?: string;
  /** Move the view to a placement behind it. The prior control is offered only when this is given. */
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

  // Read the discriminant once, as a value: the chip, the select's value and its options all need it.
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
