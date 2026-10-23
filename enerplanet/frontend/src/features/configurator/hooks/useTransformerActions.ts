import { useCallback } from "react";
import { pylovoService, siteScope } from "@/features/configurator/services/pylovoService";
import { removeSiteStation } from "@/features/configurator/utils/siteStations";
import { useModelStore } from "@/features/configurator/store/modelStore";

interface TransformerActionsOptions {
  updateTransformerKva: (gridResultId: number, newKva: number) => void;
  notification: {
    showSuccess: (message: string) => void;
    showError: (message: string) => void;
  };
  userId: string | undefined;
  existingModelId: number | undefined;
  draftId: string | undefined;
  refreshGrid: () => Promise<void>;
}

export const useTransformerActions = ({
  updateTransformerKva,
  notification,
  userId,
  existingModelId,
  draftId,
  refreshGrid,
}: TransformerActionsOptions) => {
  const selectedTransformer = useModelStore((s) => s.selectedTransformer);
  const setSelectedTransformer = useModelStore((s) => s.setSelectedTransformer);

  const handleTransformerKvaChange = useCallback(
    (newKva: number) => {
      if (selectedTransformer) {
        updateTransformerKva(selectedTransformer.gridResultId, newKva);
        setSelectedTransformer(
          (prev: any) =>
            prev ? { ...prev, ratedPowerKva: newKva } : null
        );
        notification.showSuccess(`Transformer updated to ${newKva} kVA`);
      }
    },
    [selectedTransformer, notification, updateTransformerKva, setSelectedTransformer]
  );

  const handleDeleteTransformer = useCallback(
    async (gridResultId: number) => {
      try {
        const grid = useModelStore.getState().pylovoGridData;
        const site = siteScope(grid);
        if (site && grid) {
          await removeSiteStation(site.site_id, grid, gridResultId);
          notification.showSuccess("Transformer deleted");
        } else {
          const result = await pylovoService.deleteTransformer(
            gridResultId,
            userId,
            existingModelId,
            draftId
          );
          notification.showSuccess(result.message || "Transformer deleted");
        }
        await refreshGrid();
      } catch (error: any) {
        console.error("Failed to delete transformer:", error);
        notification.showError(error?.message || "Failed to delete transformer");
      }
    },
    [notification, refreshGrid, userId, existingModelId, draftId]
  );

  return { handleTransformerKvaChange, handleDeleteTransformer };
};
