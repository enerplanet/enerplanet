import { useCallback } from 'react';
import { downloadModelArchive } from '@/features/model-dashboard/services/modelDownloadService';

export function useAdminModelActions() {
  return useCallback(async (action: string, modelId: number) => {
    if (action !== 'download') {
      return;
    }

    try {
      await downloadModelArchive(modelId, `sim_${modelId}.zip`);
    } catch (error) {
      if (import.meta.env.DEV) {
        console.error('Download failed:', error);
      }
    }
  }, []);
}
