import { useCallback } from 'react';
import { useConfirm } from '@/hooks/useConfirmDialog';
import { Model } from '@/features/model-dashboard/services/modelService';
import { familyId } from '@/features/model-dashboard/utils/dashboardHelpers';

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

		// Families losing some, not all, of their models: the rest stay together.
		const selectedIDs = new Set(selectedModels.map((m: Model) => m.id));
		const partlyDeletedFamilies = new Set(
			selectedModels
				.filter((model: Model) => !isModelDisabled(model))
				.filter((model: Model) => sortedModels.some((m: Model) => !selectedIDs.has(m.id) && familyId(m) === familyId(model)))
				.map(familyId),
		);

		const description = buildBulkDeleteDescription(
			selectedModels.length,
			partlyDeletedFamilies.size,
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
	partlyDeletedFamilies: number,
	nonDeletableCount: number
): string {
	let description = `Are you sure you want to delete ${totalCount} selected model${totalCount > 1 ? "s" : ""}?`;

	if (partlyDeletedFamilies > 0) {
		description += ` The models you did not select stay in their ${partlyDeletedFamilies > 1 ? "families" : "family"}, each headed by its oldest model.`;
	}

	if (nonDeletableCount > 0) {
		description += ` ${nonDeletableCount} model${nonDeletableCount > 1 ? "s" : ""} that ${nonDeletableCount > 1 ? "are" : "is"} currently running will be skipped.`;
	}

	description += " This action cannot be undone.";
	return description;
}
