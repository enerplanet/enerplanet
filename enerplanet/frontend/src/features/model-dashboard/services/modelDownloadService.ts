import { modelService } from '@/features/model-dashboard/services/modelService';
import { downloadBlobResponse } from '@/utils/fileDownload';

export async function downloadModelArchive(modelId: number, fallbackFilename = `sim_${modelId}.zip`): Promise<string> {
  const response = await modelService.downloadModelResults(modelId);
  return downloadBlobResponse(response, fallbackFilename);
}
