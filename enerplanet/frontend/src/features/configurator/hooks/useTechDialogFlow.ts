import { useCallback, useRef } from "react";
import type { Feature } from "ol";
import type { Geometry } from "ol/geom";
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

  /** Opens the product dialog for adding tech to building. */
  const addTechToBuilding = useCallback(
    (building: Feature<Geometry>, tech: Technology) => {
      setSelectedTechForDialog(tech);
      setSelectedBuildingForTech(building);
      setTechDialogStep("pick");
      setTechDialogOpen(true);
    },
    [setSelectedTechForDialog, setSelectedBuildingForTech, setTechDialogOpen, setTechDialogStep]
  );

  const handleAddTechFromDialog = useCallback(
    (tech: Technology) => {
      if (!selectedBuildingFeature) return;
      techAddedFromBuildingDialogRef.current = true;
      setBuildingDialogOpen(false);
      addTechToBuilding(selectedBuildingFeature, tech);
    },
    [selectedBuildingFeature, setBuildingDialogOpen, addTechToBuilding]
  );

  return {
    techAddedFromBuildingDialogRef,
    handleAddTechFromDialog,
    addTechToBuilding,
  };
};
