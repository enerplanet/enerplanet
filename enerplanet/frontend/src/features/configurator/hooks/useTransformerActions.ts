import { useCallback } from "react";
import { pylovoService } from "@/features/configurator/services/pylovoService";

interface TransformerActionsOptions {
  selectedTransformer: { gridResultId: number; ratedPowerKva: number } | null;
  setSelectedTransformer: (updater: (prev: any) => any) => void;
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
  selectedTransformer,
  setSelectedTransformer,
  updateTransformerKva,
  notification,
  userId,
  existingModelId,
  draftId,
  allPolygons,
  handlePolygonModified,
}: TransformerActionsOptions) => {
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
