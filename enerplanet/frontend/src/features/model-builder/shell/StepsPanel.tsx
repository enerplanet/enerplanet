/**
 * The steps panel — the frame's right-hand band, a sibling of the module frame.
 *
 * A step behind the session is a control; clicking one moves the view there — the shell's session
 * state, which writes nothing. Steps ahead of the frontier are not clickable: a later node is
 * reached by running it, not by standing on it.
 *
 * Colours come from the theme's semantic pairs, so the states survive dark mode.
 */

import { useState } from "react";
import { useTranslation } from "@spatialhub/i18n";
import { stepsState, type StepRow } from "./stepsState";
import type { Flow, ModuleRegistry } from "../core/flow";
import type { Store } from "../core/store";

/** Text states — for the labels. */
const STATE_CLASS: Record<StepRow["state"], string> = {
  done: "text-emerald-600 dark:text-emerald-400",
  stale: "text-amber-600 dark:text-amber-400",
  pending: "text-muted-foreground",
};

/** The dots — the rail's whole vocabulary. */
const DOT_CLASS: Record<StepRow["state"], string> = {
  done: "bg-emerald-500",
  stale: "bg-amber-500",
  pending: "bg-muted-foreground/40",
};

interface Props {
  flow: Flow;
  registry: ModuleRegistry;
  store: Store;
  /** The placement the session is looking at; absent, the frontier is what is marked. */
  view?: string;
  /** Move the view to a step behind it. Absent in test mode, where there is no position to move. */
  onMove?: (nodeId: string) => void;
}

/** One step's body — shared by the control and the plain rendering, so the two can never drift apart. */
const StepBody: React.FC<{ step: StepRow; open: boolean }> = ({ step, open }) => {
  const { t } = useTranslation();

  return (
    <>
      <span
        className={`mt-1 h-2 w-2 shrink-0 rounded-full ${DOT_CLASS[step.state]} ${
          step.current ? "ring-2 ring-sky-500 ring-offset-1 ring-offset-card" : ""
        }`}
      />

      {open && (
        <span className="min-w-0 flex-1">
          <span className={`block truncate text-sm ${STATE_CLASS[step.state]}`}>{step.label}</span>

          {step.blocked.length > 0 && (
            <span className="block truncate text-xs text-destructive">
              {t("modelBuilder.steps.blocked", "needs {{ports}}", {
                ports: step.blocked.join(", "),
              })}
            </span>
          )}

          {step.blocked.length === 0 && step.pruned.length > 0 && (
            <span className="block truncate text-xs text-amber-600 dark:text-amber-400">
              {t("modelBuilder.steps.pruned", "lost {{ports}}", {
                ports: step.pruned.join(", "),
              })}
            </span>
          )}
        </span>
      )}
    </>
  );
};

export const StepsPanel: React.FC<Props> = ({ flow, registry, store, view, onMove }) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  const steps = stepsState(flow, registry, store, view);

  return (
    <aside
      className={`flex min-h-0 shrink-0 flex-col border-l border-border bg-card ${
        open ? "w-1/3" : "w-12"
      }`}
    >
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2 text-left hover:bg-muted"
      >
        <span className="text-xs text-muted-foreground/70">{open ? "▸" : "◂"}</span>
        {open && (
          <span className="text-xs font-medium text-muted-foreground">{t("modelBuilder.steps.title")}</span>
        )}
      </button>

      <ol className="min-h-0 flex-1 overflow-auto py-1">
        {steps.map((step) => {
          const move = step.movable && onMove !== undefined;

          return (
            <li key={step.nodeId} className="flex items-start">
              {move ? (
                <button
                  type="button"
                  onClick={() => onMove(step.nodeId)}
                  // Named by the step it moves to, so the control is not just a chevron to a screen reader.
                  aria-label={t("modelBuilder.steps.moveTo", "Go to {{step}}", { step: step.label })}
                  className="flex w-full items-start gap-2 rounded px-3 py-1.5 text-left hover:bg-muted"
                >
                  <StepBody step={step} open={open} />
                </button>
              ) : (
                <div className="flex w-full items-start gap-2 px-3 py-1.5">
                  <StepBody step={step} open={open} />
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </aside>
  );
};

export default StepsPanel;
