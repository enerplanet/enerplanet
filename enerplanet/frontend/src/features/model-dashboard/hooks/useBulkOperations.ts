import { useCallback } from 'react';
import { useConfirm } from '@/hooks/useConfirmDialog';
import { Model } from '@/features/model-dashboard/services/modelService';

interface UseBulkOperationsProps {
	selectedModels: Model[];
	sortedModels: Model[];
	isModelDisabled: (model: Model) => boolean;
	onBulkDelete: () => Promise<void>;
	onClearSelection: () => void;
	onLoadStats: () => Promise<void>;
}

export const useBulkOperations = ({
	selectedModels,
	sortedModels,
	isModelDisabled,
	onBulkDelete,
	onClearSelection,
	onLoadStats,
}: UseBulkOperationsProps) => {
	const confirm = useConfirm();

	const showBulkDeleteConfirm = useCallback(async () => {
		const deletableCount = selectedModels.filter((model: Model) => !isModelDisabled(model)).length;
		const nonDeletableCount = selectedModels.length - deletableCount;

		const parentsWithChildren = selectedModels.filter((model: Model) => {
			const hasChildren = sortedModels.some((m: Model) => m.parent_model_id === model.id);
			return hasChildren && !isModelDisabled(model);
		});

		const description = buildBulkDeleteDescription(
			selectedModels.length,
			parentsWithChildren.length,
			nonDeletableCount
		);

		await confirm({
			type: "delete",
			itemType: selectedModels.length > 1 ? "models" : "model",
			itemName: selectedModels.length === 1 ? selectedModels[0].title : `${selectedModels.length} models`,
			description: description,
			onConfirm: async () => {
				onClearSelection();
				try {
					await onBulkDelete();
					await onLoadStats();
				} catch (error) {
					if (import.meta.env.DEV) console.error("Bulk delete failed:", error);
					alert("Some models could not be deleted. Please try again.");
				}
			}
		});
	}, [selectedModels, sortedModels, isModelDisabled, confirm, onBulkDelete, onClearSelection, onLoadStats]);

	return { showBulkDeleteConfirm };
};

function buildBulkDeleteDescription(
	totalCount: number,
	parentsCount: number,
	nonDeletableCount: number
): string {
	let description = `Are you sure you want to delete ${totalCount} selected model${totalCount > 1 ? "s" : ""}?`;

	if (parentsCount > 0) {
		description += ` ${parentsCount} parent model${parentsCount > 1 ? "s" : ""} with children will have their child models remain and become independent.`;
	}

	if (nonDeletableCount > 0) {
		description += ` ${nonDeletableCount} model${nonDeletableCount > 1 ? "s" : ""} that ${nonDeletableCount > 1 ? "are" : "is"} currently running will be skipped.`;
	}

	description += " This action cannot be undone.";
	return description;
}
