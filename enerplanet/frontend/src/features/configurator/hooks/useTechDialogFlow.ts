import { useCallback, useRef } from "react";
import type { Technology } from "@/features/technologies/services/technologyService";

interface TechDialogFlowOptions {
  mapInteractions: {
    selectedBuildingFeature: any;
    setBuildingDialogOpen: (open: boolean) => void;
  };
  techOperations: {
    setSelectedTechForDialog: (tech: Technology | null) => void;
    setSelectedBuildingForTech: (feature: any) => void;
    setTechDialogOpen: (open: boolean) => void;
  };
  multiEditSelectedIds: Set<string>;
}

export const useTechDialogFlow = ({
  mapInteractions,
  techOperations,
  multiEditSelectedIds,
}: TechDialogFlowOptions) => {
  const techAddedFromBuildingDialogRef = useRef(false);

  const handleAddTechFromDialog = useCallback(
    (tech: Technology) => {
      if (!mapInteractions.selectedBuildingFeature) return;
      techAddedFromBuildingDialogRef.current = true;
      mapInteractions.setBuildingDialogOpen(false);
      techOperations.setSelectedTechForDialog(tech);
      techOperations.setSelectedBuildingForTech(mapInteractions.selectedBuildingFeature);
      techOperations.setTechDialogOpen(true);
    },
    [mapInteractions, techOperations]
  );

  const handleApplyTechToSelected = useCallback(
    (tech: Technology) => {
      if (multiEditSelectedIds.size === 0) return;
      if (mapInteractions.selectedBuildingFeature) {
        techAddedFromBuildingDialogRef.current = true;
        mapInteractions.setBuildingDialogOpen(false);
        techOperations.setSelectedTechForDialog(tech);
        techOperations.setSelectedBuildingForTech(mapInteractions.selectedBuildingFeature);
        techOperations.setTechDialogOpen(true);
      }
    },
    [multiEditSelectedIds, mapInteractions, techOperations]
  );

  return {
    techAddedFromBuildingDialogRef,
    handleAddTechFromDialog,
    handleApplyTechToSelected,
  };
};
