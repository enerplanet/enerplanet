/**
 * The steps panel — the frame's right-hand band (`spec/frame.md` §2, §3.3).
 *
 * A **sibling of the module frame**, full height, collapsed to a rail by default: its job is to answer "where
 * am I in this workflow" at a glance and then get out of the way. The rail keeps the state legible as a dot
 * even when there is no room for words, so collapsing costs context but not information.
 *
 * **Info-only.** Clicking a step to jump to it is designed and deliberately not built: it would make every
 * step a potential jump, and a jump deserves the discard preview it ought to show before it commits. So the
 * rail is not a control, and nothing here looks like one — the only thing that responds to a click is the
 * toggle.
 *
 * Colours come from the theme's semantic pairs rather than raw hues, so the states survive dark mode.
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
}

export const StepsPanel: React.FC<Props> = ({ flow, registry, store }) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  const steps = stepsState(flow, registry, store);

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
        {steps.map((step) => (
          <li key={step.nodeId} className="flex items-start gap-2 px-3 py-1.5">
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
          </li>
        ))}
      </ol>
    </aside>
  );
};

export default StepsPanel;
