import { useCallback } from 'react';
import { useConfirm } from '@/hooks/useConfirmDialog';
import { Model } from '@/features/model-dashboard/services/modelService';

interface UseDeleteConfirmProps {
	sortedModels: Model[];
	onDelete: (model: Model) => Promise<void>;
	onLoadStats: () => Promise<void>;
}

export const useDeleteConfirm = ({
	sortedModels,
	onDelete,
	onLoadStats,
}: UseDeleteConfirmProps) => {
	const confirm = useConfirm();

	const handleSingleDelete = useCallback(async (model: Model) => {
		const children = sortedModels.filter((m: Model) => m.parent_model_id === model.id);
		const hasChildren = children.length > 0;

		let customDescription: string | undefined;
		if (hasChildren) {
			const childText = children.length > 1 ? "s" : "";
			customDescription = `Are you sure you want to delete "${model.title}"? This model has ${children.length} child model${childText} that will remain but become independent. This action cannot be undone.`;
		}

		await confirm({
			type: "delete",
			itemType: "model",
			itemName: model.title,
			description: customDescription,
			onConfirm: async () => {
				try {
					await onDelete(model);
					await onLoadStats();
				} catch (error) {
					if (import.meta.env.DEV) console.error("Delete failed:", error);
					alert("Failed to delete the model. Please try again.");
				}
			}
		});
	}, [sortedModels, confirm, onDelete, onLoadStats]);

	return { handleSingleDelete };
};
