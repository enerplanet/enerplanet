import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Model } from '@/features/model-dashboard/services/modelService';
import { downloadModelArchive } from '@/features/model-dashboard/services/modelDownloadService';
import {
  useDuplicateModelMutation,
  useDeleteModelMutation,
  useUpdateModelMutation,
  useStartCalculationMutation,
  useBulkDeleteModelsMutation
} from '@/features/model-dashboard/hooks/useModelsQuery';

interface UseModelDashboardHandlersProps {
  onRefresh: () => Promise<void>;
  onStatsRefresh: () => Promise<void>;
}

export const useModelDashboardHandlers = ({ onRefresh, onStatsRefresh }: UseModelDashboardHandlersProps) => {
  const navigate = useNavigate();
  const duplicateMutation = useDuplicateModelMutation();
  const deleteMutation = useDeleteModelMutation();
  const updateMutation = useUpdateModelMutation();
  const startCalculationMutation = useStartCalculationMutation();
  const bulkDeleteMutation = useBulkDeleteModelsMutation();

  const refreshData = useCallback(async () => {
    await Promise.allSettled([onRefresh(), onStatsRefresh()]);
  }, [onRefresh, onStatsRefresh]);

  const handleEdit = useCallback((model: Model): void => {
    navigate(`/app/model-dashboard/edit/${model.id}`);
  }, [navigate]);

  const handleView = useCallback((model: Model): void => {
    navigate(`/app/model-results/${model.id}`);
  }, [navigate]);

  const handleCopy = useCallback(async (model: Model): Promise<void> => {
    try {
      await duplicateMutation.mutateAsync(model.id);
      await refreshData();
    } catch (error) {
      if (import.meta.env.DEV) console.error('Failed to copy model:', error);
    }
  }, [duplicateMutation, refreshData]);

  const handleDelete = useCallback(async (model: Model): Promise<void> => {
    try {
      await deleteMutation.mutateAsync(model.id);
      await refreshData();
    } catch (error) {
      if (import.meta.env.DEV) console.error('Failed to delete model:', error);
      throw error;
    }
  }, [deleteMutation, refreshData]);

  const handleCalculate = useCallback(async (modelIds: number[]): Promise<void> => {
    try {
      for (const id of modelIds) {
        await startCalculationMutation.mutateAsync(id);
      }
      await refreshData();
    } catch (error) {
      if (import.meta.env.DEV) console.error('Failed to start calculation:', error);
    }
  }, [startCalculationMutation, refreshData]);

  const handleDownload = useCallback(async (model: Model): Promise<void> => {
    try {
      await downloadModelArchive(model.id, `model_${model.id}.zip`);
    } catch (error) {
      if (import.meta.env.DEV) console.error('Download failed:', error);
    }
  }, []);

  const updateTitle = useCallback(async (model: Model | null, title: string): Promise<void> => {
    if (model && title.trim()) {
      try {
        await updateMutation.mutateAsync({
          id: model.id,
          data: { title: title.trim() }
        });
        await refreshData();
      } catch (error) {
        if (import.meta.env.DEV) console.error('Failed to update title:', error);
      }
    }
  }, [updateMutation, refreshData]);

  const handleBulkDelete = useCallback(async (modelIds: number[]): Promise<void> => {
    try {
      await bulkDeleteMutation.mutateAsync(modelIds);
      await refreshData();
    } catch (error) {
      if (import.meta.env.DEV) console.error('Failed to delete models:', error);
      throw error;
    }
  }, [bulkDeleteMutation, refreshData]);

  return {
    handleEdit,
    handleView,
    handleCopy,
    handleDelete,
    handleCalculate,
    handleDownload,
    updateTitle,
    handleBulkDelete,
  };
};
