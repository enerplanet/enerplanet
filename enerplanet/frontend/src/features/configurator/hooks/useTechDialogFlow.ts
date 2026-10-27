import { useCallback, useRef } from "react";
import type { Technology } from "@/features/technologies/services/technologyService";
import { useModelStore } from "@/features/configurator/store/modelStore";

export const useTechDialogFlow = () => {
  const techAddedFromBuildingDialogRef = useRef(false);

  const selectedBuildingFeature = useModelStore((s) => s.selectedBuildingFeature);
  const setBuildingDialogOpen = useModelStore((s) => s.setBuildingDialogOpen);
  const setSelectedTechForDialog = useModelStore((s) => s.setSelectedTechForDialog);
  const setSelectedBuildingForTech = useModelStore((s) => s.setSelectedBuildingForTech);
  const setTechDialogOpen = useModelStore((s) => s.setTechDialogOpen);
  const setTechDialogStep = useModelStore((s) => s.setTechDialogStep);

  const handleAddTechFromDialog = useCallback(
    (tech: Technology) => {
      if (!selectedBuildingFeature) return;
      techAddedFromBuildingDialogRef.current = true;
      setBuildingDialogOpen(false);
      setSelectedTechForDialog(tech);
      setSelectedBuildingForTech(selectedBuildingFeature);
      setTechDialogStep("pick");
      setTechDialogOpen(true);
    },
    [selectedBuildingFeature, setBuildingDialogOpen, setSelectedTechForDialog, setSelectedBuildingForTech, setTechDialogOpen, setTechDialogStep]
  );

  return {
    techAddedFromBuildingDialogRef,
    handleAddTechFromDialog,
  };
};
