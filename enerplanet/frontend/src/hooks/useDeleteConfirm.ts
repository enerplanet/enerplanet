import { useCallback } from 'react';
import { useConfirm } from '@/hooks/useConfirmDialog';
import { Model } from '@/features/model-dashboard/services/modelService';
import { familyId } from '@/features/model-dashboard/utils/dashboardHelpers';

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
		const family = sortedModels.filter((m: Model) => m.id !== model.id && familyId(m) === familyId(model));

		let customDescription: string | undefined;
		if (family.length > 0) {
			const copyText = family.length > 1 ? "copies stay" : "copy stays";
			customDescription = `Are you sure you want to delete "${model.title}"? Its ${family.length} ${copyText} in the family, which the oldest model then heads. This action cannot be undone.`;
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
