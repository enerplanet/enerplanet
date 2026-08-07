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
		setSelectedModels((prev) =>
			prev.some((selected) => selected.id === model.id)
				? prev.filter((selected) => selected.id !== model.id)
				: [...prev, model]
		);
	}, []);

	const handleSelectAll = useCallback((filteredModels: Model[]): void => {
		setSelectedModels((prev) =>
			prev.length === filteredModels.length ? [] : [...filteredModels]
		);
	}, []);

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
