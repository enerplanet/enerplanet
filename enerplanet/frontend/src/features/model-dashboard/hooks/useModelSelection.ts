import { useState, useCallback } from 'react';
import { Model } from '@/features/model-dashboard/services/modelService';

export const useModelSelection = () => {
	const [selectedModels, setSelectedModels] = useState<Model[]>([]);
	const [editingModel, setEditingModel] = useState<Model | null>(null);
	const [editTitle, setEditTitle] = useState<string>("");

	const isSelected = useCallback((model: Model): boolean => {
		return selectedModels.some((selected) => selected.id === model.id);
	}, [selectedModels]);

	const handleSelectModel = useCallback((model: Model): void => {
		if (isSelected(model)) {
			setSelectedModels(selectedModels.filter((selected) => selected.id !== model.id));
		} else {
			setSelectedModels([...selectedModels, model]);
		}
	}, [selectedModels, isSelected]);

	const handleSelectAll = useCallback((filteredModels: Model[]): void => {
		if (selectedModels.length === filteredModels.length) {
			setSelectedModels([]);
		} else {
			setSelectedModels([...filteredModels]);
		}
	}, [selectedModels]);

	const startTitleEdit = useCallback((model: Model): void => {
		setEditingModel(model);
		setEditTitle(model.title);
	}, []);

	const cancelTitleEdit = useCallback((): void => {
		setEditingModel(null);
		setEditTitle("");
	}, []);

	const clearSelection = useCallback(() => {
		setSelectedModels([]);
	}, []);

	return {
		selectedModels,
		editingModel,
		editTitle,
		isSelected,
		handleSelectModel,
		handleSelectAll,
		startTitleEdit,
		cancelTitleEdit,
		setEditTitle,
		clearSelection,
	};
};
