// Container for the per-building configurator. Reads the open building and
// active stage from the URL (useConfiguratorParams), renders the stage selector
// and the active stage's editor. Stage editors are added by issues #30-#34;
// until a stage has a Component it shows a placeholder.
//
// This mounts alongside the existing BuildingDialog and only becomes visible
// once `?building=` is in the URL, which nothing sets yet. The map click flow
// is switched over to it in a later issue.

import { Button, Sheet, SheetContent, SheetTitle } from "@spatialhub/ui";
import type { FC } from "react";
import { StageStepper } from "./StageStepper";
import { nextStage, prevStage, stageDef } from "./stages";
import { useConfiguratorParams } from "./useConfiguratorParams";

export const ConfiguratorShell: FC = () => {
  const { buildingId, stage, isOpen, setStage, close } = useConfiguratorParams();

  if (!isOpen || buildingId === null) return null;

  const def = stageDef(stage);
  const prev = prevStage(stage);
  const next = nextStage(stage);

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && close()}>
      <SheetContent side="right" className="sm:max-w-xl gap-0 p-0">
        <div className="border-b p-4">
          <SheetTitle className="text-base">Configure building</SheetTitle>
          <p className="text-muted-foreground mt-0.5 text-xs">{buildingId}</p>
          <div className="mt-4">
            <StageStepper current={stage} onSelect={setStage} />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {def.Component ? (
            <def.Component buildingId={buildingId} />
          ) : (
            <p className="text-muted-foreground text-sm">
              The {def.label.toLowerCase()} stage is not built yet.
            </p>
          )}
        </div>

        <div className="flex items-center justify-between border-t p-4">
          <Button
            variant="ghost"
            disabled={prev === null}
            onClick={() => prev && setStage(prev)}
          >
            Back
          </Button>
          <Button
            disabled={next === null}
            onClick={() => next && setStage(next)}
          >
            Next
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
};
