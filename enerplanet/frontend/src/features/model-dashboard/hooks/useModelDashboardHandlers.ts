import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Model } from '@/features/model-dashboard/services/modelService';
import { downloadModelArchive } from '@/features/model-dashboard/services/modelDownloadService';
import {
  useDuplicateModelMutation,
  useDeleteModelMutation,
  useUpdateModelMutation,
  useRunMemeMutation,
  useRunMemePypsaMutation,
  useBulkDeleteModelsMutation
} from '@/features/model-dashboard/hooks/useModelsQuery';

interface UseModelDashboardHandlersProps {
  onRefresh: () => Promise<void>;
  onStatsRefresh: () => Promise<void>;
  onDownloadError: (reason: string) => void;
}

// A failed blob request carries the server's JSON error as a Blob.
async function downloadErrorReason(error: unknown): Promise<string> {
  const data = (error as { response?: { data?: unknown } })?.response?.data;
  if (data instanceof Blob) {
    try {
      const parsed = JSON.parse(await data.text()) as { error?: unknown };
      if (typeof parsed.error === 'string' && parsed.error) return parsed.error;
    } catch {
      // Not JSON: fall through to the error's own message.
    }
  }
  return error instanceof Error ? error.message : String(error);
}

export const useModelDashboardHandlers = ({ onRefresh, onStatsRefresh, onDownloadError }: UseModelDashboardHandlersProps) => {
  const navigate = useNavigate();
  const duplicateMutation = useDuplicateModelMutation();
  const deleteMutation = useDeleteModelMutation();
  const updateMutation = useUpdateModelMutation();
  const runMemeMutation = useRunMemeMutation();
  const runMemePypsaMutation = useRunMemePypsaMutation();
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

  const handleRunMeme = useCallback(async (modelIds: number[]): Promise<void> => {
    try {
      for (const id of modelIds) {
        await runMemeMutation.mutateAsync(id);
      }
      await refreshData();
    } catch (error) {
      if (import.meta.env.DEV) console.error('Failed to start MEME calculation:', error);
    }
  }, [runMemeMutation, refreshData]);

  // Isolated PyPSA power-flow leg: a derived run AFTER a successful Calliope
  // run, so it targets only completed models (the backend enforces the gate).
  const handleRunMemePypsa = useCallback(async (modelIds: number[]): Promise<void> => {
    try {
      for (const id of modelIds) {
        await runMemePypsaMutation.mutateAsync(id);
      }
      await refreshData();
    } catch (error) {
      if (import.meta.env.DEV) console.error('Failed to start MEME PyPSA leg:', error);
    }
  }, [runMemePypsaMutation, refreshData]);

  const handleDownload = useCallback(async (model: Model): Promise<void> => {
    try {
      await downloadModelArchive(model.id, `model_${model.id}.zip`);
    } catch (error) {
      onDownloadError(await downloadErrorReason(error));
    }
  }, [onDownloadError]);

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
    handleRunMeme,
    handleRunMemePypsa,
    handleDownload,
    updateTitle,
    handleBulkDelete,
  };
};
