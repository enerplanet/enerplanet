import { useCallback, useRef } from "react";
import type { Technology } from "@/features/technologies/services/technologyService";
import { useModelStore } from "@/features/configurator/store/modelStore";

interface TechDialogFlowOptions {
  multiEditSelectedIds: Set<string>;
}

export const useTechDialogFlow = ({
  multiEditSelectedIds,
}: TechDialogFlowOptions) => {
  const techAddedFromBuildingDialogRef = useRef(false);

  const selectedBuildingFeature = useModelStore((s) => s.selectedBuildingFeature);
  const setBuildingDialogOpen = useModelStore((s) => s.setBuildingDialogOpen);
  const setSelectedTechForDialog = useModelStore((s) => s.setSelectedTechForDialog);
  const setSelectedBuildingForTech = useModelStore((s) => s.setSelectedBuildingForTech);
  const setTechDialogOpen = useModelStore((s) => s.setTechDialogOpen);

  const handleAddTechFromDialog = useCallback(
    (tech: Technology) => {
      if (!selectedBuildingFeature) return;
      techAddedFromBuildingDialogRef.current = true;
      setBuildingDialogOpen(false);
      setSelectedTechForDialog(tech);
      setSelectedBuildingForTech(selectedBuildingFeature);
      setTechDialogOpen(true);
    },
    [selectedBuildingFeature, setBuildingDialogOpen, setSelectedTechForDialog, setSelectedBuildingForTech, setTechDialogOpen]
  );

  const handleApplyTechToSelected = useCallback(
    (tech: Technology) => {
      if (multiEditSelectedIds.size === 0) return;
      if (selectedBuildingFeature) {
        techAddedFromBuildingDialogRef.current = true;
        setBuildingDialogOpen(false);
        setSelectedTechForDialog(tech);
        setSelectedBuildingForTech(selectedBuildingFeature);
        setTechDialogOpen(true);
      }
    },
    [multiEditSelectedIds, selectedBuildingFeature, setBuildingDialogOpen, setSelectedTechForDialog, setSelectedBuildingForTech, setTechDialogOpen]
  );

  return {
    techAddedFromBuildingDialogRef,
    handleAddTechFromDialog,
    handleApplyTechToSelected,
  };
};
