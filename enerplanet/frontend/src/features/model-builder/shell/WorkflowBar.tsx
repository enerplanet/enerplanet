/**
 * The workflow bar — the frame's top band (`spec/frame.md` §2, §3.1).
 *
 * Dense by rule: it is chrome, and vertical space belongs to the content. It shows the three steps that frame
 * the session and nothing else — apart from two dev controls, which exist only because two things are not
 * built yet: undo (so *Reset* is the only way back to a position that has not run) and the steps panel (so
 * the mode select is the only way to point the frame at a module the workflow does not place).
 *
 * In **test mode** there is no position to show, so it says so instead of rendering a bar of dashes: a bar
 * naming steps while no workflow was driving would be lying about where the session is.
 *
 * Everything it renders in workflow mode comes from `barState`, so the bar holds no knowledge of history that
 * could fall out of date.
 */

import { useTranslation } from "@spatialhub/i18n";
import { barState, type BarStep } from "./barState";
import type { FrameMode } from "./frameMode";
import type { Workflow } from "./workflow";
import type { Store } from "../core/store";

/** Semantic theme pairs rather than raw hues, so the states read correctly in dark mode too. */
const STATE_CLASS: Record<BarStep["state"], string> = {
  done: "text-emerald-600 dark:text-emerald-400",
  stale: "text-amber-600 dark:text-amber-400",
  pending: "text-muted-foreground",
};

/** One framed step: the role, and the node filling it (or a dash when there is none). */
const Step: React.FC<{ label: string; step: BarStep | undefined }> = ({ label, step }) => (
  <span className="flex items-baseline gap-1.5">
    <span className="text-[0.7rem] uppercase tracking-wide text-muted-foreground/70">{label}</span>
    {step === undefined ? (
      <span className="text-sm text-muted-foreground/70">—</span>
    ) : (
      <span className={`text-sm font-medium ${STATE_CLASS[step.state]}`}>{step.label}</span>
    )}
  </span>
);

interface Props {
  workflow: Workflow;
  store: Store;
  mode: FrameMode;
  /** The module ids a developer can point the frame at in test mode. */
  moduleIds: readonly string[];
  onModeChange?: (mode: FrameMode) => void;
  onReset?: () => void;
}

export const WorkflowBar: React.FC<Props> = ({ workflow, store, mode, moduleIds, onModeChange, onReset }) => {
  const { t } = useTranslation();
  const bar = barState(workflow.flow, workflow.registry, store);

  // Read the discriminant once, as a value: the chip, the select's value and its options all need it, and a
  // boolean alias would have to re-narrow the union at every use.
  const testModuleId = mode.kind === "test" ? mode.moduleId : undefined;

  return (
    <header className="flex shrink-0 flex-wrap items-center justify-between gap-4 border-b border-border bg-card px-4 py-2">
      <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1">
        <span className="truncate text-sm font-semibold">{workflow.label}</span>

        {testModuleId === undefined ? (
          <>
            <nav className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
              <Step label={t("modelBuilder.bar.prior")} step={bar.prior} />
              <Step label={t("modelBuilder.bar.current")} step={bar.current} />
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
