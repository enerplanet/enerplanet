/**
 * Installs the building configurator: the legacy's `BuildingPanelHost`, wrapped for our module's slot.
 *
 * **Imports only — nothing in the legacy is edited** (the boundary rule). The host already takes what it needs
 * as props and owns its own chrome — the scrim, the back button, Escape (an open surface editor first, the
 * building second) — so nothing here re-implements any of it.
 *
 * Three translations live here, at the seam, and nowhere else:
 *
 * - **Open and close.** The legacy drives the panel through `useConfiguratorParams`, a URL param rather than a
 *   prop, so this wrapper calls `openBuilding(osmId)` when the module hands it a building, and reports the
 *   param returning to `null` — the host's own close, by Escape or its back button — as the module's
 *   `onClose`. The module never learns that a param exists.
 * - **The building's stored edit.** The view returns a `StoredBuem`: the legacy's envelope and thermal block,
 *   kept on the feature under `properties.buem`. Our store has no port for it and does not pretend to — it
 *   rides on the feature, which is where the legacy keeps it and where the save's fold already writes.
 * - **Technologies.** The view returns a `BuildingTechs` map keyed by type; the store holds `TechAssignment[]`.
 *   The constraint list becomes the assignment's params, and `alias` becomes its catalogue product.
 *
 * The owner path is the store's own `draftId` — the module reads it and passes it down, because
 * `BuildingPanelHost` refuses to render without one (it scopes draft-scoped transformer results). The draft is
 * a client-side UUID in the legacy too (`useAreaSelect`), not something the backend hands out, so the shell
 * seeds it rather than fetching it.
 */

import { useEffect, useRef, type FC } from "react";

import type { TechAssignment } from "@model-builder/core";
import { BuildingPanelHost, useConfiguratorParams } from "@/features/configurator/building-config";
import type { BuildingTechs } from "@/features/configurator/building-config/buildingTechnologies";
import { useModelStore } from "@/features/configurator/store/modelStore";

import { setBuildingConfigurator, type BuildingViewProps } from "../modules/building-configurator/view";

/** The legacy's constraint list as an assignment's params. */
function paramsOf(tech: BuildingTechs[string]): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  for (const constraint of tech.constraints ?? []) {
    if (typeof constraint.key === "string" && constraint.key.length > 0) {
      params[constraint.key] = constraint.value;
    }
  }
  if (typeof tech.alias === "string" && tech.alias.length > 0) params.product = tech.alias;
  return params;
}

/** The store's assignments as the map the view's Technologies tab reads. */
function toBuildingTechs(assignments: TechAssignment[] | undefined): BuildingTechs {
  const techs: BuildingTechs = {};
  for (const assignment of assignments ?? []) {
    const { product, ...constraints } = assignment.params ?? {};
    techs[assignment.techId] = {
      ...(typeof product === "string" ? { alias: product } : {}),
      constraints: Object.entries(constraints).map(([key, value]) => ({ key, value })),
    };
  }
  return techs;
}

/**
 * The view the module renders.
 *
 * It is deliberately thin: the host does the work, and everything here is either a prop translation or the
 * open/close dance. `onCommit` is called only when the host hands back a *changed* building — it compares
 * itself, and passes the building it was given when nothing happened.
 */
const View: FC<BuildingViewProps> = ({ osmId, technologies, draftId, grid, onCommit, onClose }) => {
  const { buildingId, openBuilding, close } = useConfiguratorParams();
  const setGrid = useModelStore((state) => state.setPylovoGridData);

  /**
   * Put our grid where the legacy's building state looks for it.
   *
   * `useBuildingState` resolves a building out of `useModelStore.pylovoGridData` — the legacy's own grid, which
   * nothing in this feature ever filled — so without this the configurator opens on "This building is not in the
   * loaded grid" while the building is right there in ours. Two stores, two grids, one of them empty.
   *
   * The spelling is the legacy's (`mv_lines`), and the keys stay absent when a collection is: the legacy reads
   * absence as "nothing there", which is the truth here.
   */
  useEffect(() => {
    if (grid === undefined) return;
    setGrid({
      ...(grid.buildings === undefined ? {} : { buildings: grid.buildings }),
      ...(grid.lines === undefined ? {} : { lines: grid.lines }),
      ...(grid.mvLines === undefined ? {} : { mv_lines: grid.mvLines }),
      ...(grid.transformers === undefined ? {} : { transformers: grid.transformers }),
      ...(grid.grids === undefined ? {} : { grids: grid.grids }),
    } as Parameters<typeof setGrid>[0]);
  }, [grid, setGrid]);

  // Open on the building the module picked. The host renders nothing until the param is set, so this is the
  // call that makes it appear rather than a race with its first render.
  useEffect(() => {
    openBuilding(osmId);
    return () => close();
  }, [osmId, openBuilding, close]);

  // The host closes itself (Escape, its back button) by clearing the param. That is the module's `onClose`.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (buildingId === osmId) wasOpen.current = true;
    else if (wasOpen.current) onClose();
  }, [buildingId, osmId, onClose]);

  return (
    <BuildingPanelHost
      draftId={draftId}
      onBuildingEdited={(_id, buem) => {
        // The legacy's envelope/thermal block. Our store has no port for it, so it rides on the feature, which
        // is where the legacy keeps it (`properties.buem`) and where the save's fold already writes.
        onCommit({ buem: buem as unknown });
      }}
      onTechsChange={(_id, techs) => {
        onCommit({
          technologies: Object.entries(techs).map(([techId, tech]) => ({
            techId,
            params: paramsOf(tech),
          })),
        });
      }}
      techsFor={() => toBuildingTechs(technologies)}
    />
  );
};

/** Install it. Called once, at startup, beside the grid engine and the weather source. */
export function installBuildingConfigurator(): void {
  setBuildingConfigurator({ View });
}
