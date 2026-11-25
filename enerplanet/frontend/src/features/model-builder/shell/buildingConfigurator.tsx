/**
 * Installs the building configurator: the legacy's `BuildingPanelHost`, wrapped for our module's slot.
 *
 * Imports only — nothing in the legacy is edited. Three translations live here: open/close (a URL param),
 * the building's stored edit, and technologies.
 */

import { useEffect, useRef, type FC } from "react";

import type { TechAssignment } from "@model-builder/core";
import { BuildingPanelHost, useConfiguratorParams } from "@/features/configurator/building-config";
import type { BuildingTechs } from "@/features/configurator/building-config/buildingTechnologies";
import { useAreaPreparation } from "@/features/configurator/building-config/useAreaPreparation";
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

/** The view the module renders. */
const View: FC<BuildingViewProps> = ({ osmId, technologies, draftId, grid, onCommit, onClose }) => {
  const { buildingId, openBuilding, close } = useConfiguratorParams();
  const setGrid = useModelStore((state) => state.setPylovoGridData);

  /** Put our grid where the legacy's building state looks for it. */
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

  // Open on the building the module picked; the host renders nothing until the param is set.
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

/** Starts the 3D preparation for the grid on screen, and renders nothing. */
export const BuildingPreparation: FC = () => {
  useAreaPreparation();
  return null;
};
