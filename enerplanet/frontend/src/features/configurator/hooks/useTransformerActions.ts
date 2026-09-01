import { useCallback } from "react";
import { pylovoService } from "@/features/configurator/services/pylovoService";
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
  allPolygons: [number, number][][];
  handlePolygonModified: (polygons: [number, number][][]) => Promise<void>;
}

export const useTransformerActions = ({
  updateTransformerKva,
  notification,
  userId,
  existingModelId,
  draftId,
  allPolygons,
  handlePolygonModified,
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
        const result = await pylovoService.deleteTransformer(
          gridResultId,
          userId,
          existingModelId,
          draftId
        );
        notification.showSuccess(result.message || "Transformer deleted");
        if (allPolygons.length > 0) {
          await handlePolygonModified(allPolygons);
        }
      } catch (error: any) {
        console.error("Failed to delete transformer:", error);
        notification.showError(error?.message || "Failed to delete transformer");
      }
    },
    [notification, allPolygons, handlePolygonModified, userId, existingModelId, draftId]
  );

  return { handleTransformerKvaChange, handleDeleteTransformer };
};
