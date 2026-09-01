// Horizontal stage selector for the configurator shell. Every stage is
// reachable at any time (the workflow is review-and-adjust, not a locked
// wizard); the progress bar shows position, not completion.

import { cn, Progress } from "@spatialhub/ui";
import type { FC } from "react";
import { STAGES, stageIndex, type StageId } from "./stages";

interface StageStepperProps {
  current: StageId;
  onSelect: (stage: StageId) => void;
}

export const StageStepper: FC<StageStepperProps> = ({ current, onSelect }) => {
  const currentIndex = stageIndex(current);
  const progress = ((currentIndex + 1) / STAGES.length) * 100;

  return (
    <div className="flex flex-col gap-3">
      <ol className="flex flex-wrap gap-1">
        {STAGES.map((stage, i) => {
          const active = stage.id === current;
          return (
            <li key={stage.id}>
              <button
                type="button"
                aria-current={active ? "step" : undefined}
                onClick={() => onSelect(stage.id)}
                className={cn(
                  "flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  active
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                )}
              >
                <span
                  className={cn(
                    "flex h-5 w-5 items-center justify-center rounded-full border text-xs",
                    active
                      ? "border-primary-foreground/40"
                      : "border-muted-foreground/40",
                  )}
                >
                  {i + 1}
                </span>
                {stage.label}
              </button>
            </li>
          );
        })}
      </ol>
      <Progress value={progress} className="h-1" />
    </div>
  );
};
