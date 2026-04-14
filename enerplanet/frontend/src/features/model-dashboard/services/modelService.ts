import axios from '@/lib/axios';
import { ModelStatus } from '@/types/models';
import type { AxiosResponse } from 'axios';

/**
 * 
 * This function avoids ReDoS
 * 
 * @param title
 * @returns
 */
function extractBaseTitle(title: string): string {
  if (!title) return title;
  
  // Limit title length to prevent DoS
  if (title.length > 500) {
    title = title.substring(0, 500);
  }
  
  // Check if title ends with " v<number>" pattern
  // Use simple string operations instead of regex
  const trimmedTitle = title.trim();
  const lastSpaceIndex = trimmedTitle.lastIndexOf(' ');
  
  if (lastSpaceIndex === -1) {
    return trimmedTitle;
  }
  
  const possibleVersion = trimmedTitle.substring(lastSpaceIndex);
  // Simple check: starts with " v" followed by digits
  if (possibleVersion.length >= 3 && possibleVersion.startsWith(' v')) {
    const numberPart = possibleVersion.substring(2);
    // Check if rest is all digits (safe check without regex)
    if (/^\d{1,5}$/.test(numberPart)) {
      return trimmedTitle.substring(0, lastSpaceIndex);
    }
  }
  
  return trimmedTitle;
}

interface Workspace {
  id: number;
  name: string;
  description?: string;
  user_id: string;
  user_email?: string;
  is_default: boolean;
  members?: WorkspaceMember[];
  groups?: WorkspaceGroup[];
  created_at: string;
  updated_at: string;
}

interface WorkspaceMember {
  user_id: number | string;
  email?: string;
  [key: string]: unknown;
}

interface WorkspaceGroup {
  id: number;
  name: string;
  group_id?: string;
  [key: string]: unknown;
}

export interface Model {
  id: number;
  user_id: string;
  user_email: string;
  workspace_id?: number;
  workspace?: Workspace;
  title: string;
  description?: string;
  status: ModelStatus;

  // Location
  region?: string;
  country?: string;
  coordinates?: Record<string, unknown>;
  selected_count?: number;
  resolution?: number;

  // Period
  from_date: string;
  to_date: string;

  config?: Record<string, unknown>;

  results?: Record<string, unknown>;

  // External
  session_id?: number;
  callback_url?: string;

  // Group/Hierarchy
  group_id?: number;
  parent_model_id?: number;
  is_copy?: boolean;

  // Activation
  is_active?: boolean;

  // Calculation timing
  calculation_started_at?: string;
  calculation_completed_at?: string;

  // Sharing
  shares?: ModelShare[];

  // Timestamps
  created_at: string;
  updated_at: string;
  deleted_at?: string;
}

interface ModelShare {
  user_id: number | string;
  email: string;
  [key: string]: unknown;
}

interface CreateModelRequest {
  title: string;
  description?: string;
  workspace_id?: number;
  region?: string;
  country?: string;
  coordinates?: Record<string, unknown>;
  selected_count?: number;
  from_date: string;
  to_date: string;
  config?: Record<string, unknown>;
  resolution?: number;
  group_id?: number;
  parent_model_id?: number;
  is_copy?: boolean;
}

export interface UpdateModelRequest {
  title?: string;
  description?: string;
  status?: string;
  workspace_id?: number;
  region?: string;
  country?: string;
  coordinates?: Record<string, unknown>;
  selected_count?: number;
  from_date?: string;
  to_date?: string;
  config?: Record<string, unknown>;
  results?: Record<string, unknown>;
  resolution?: number;
  session_id?: number;
  callback_url?: string;
  group_id?: number;
  parent_model_id?: number | null;
  is_copy?: boolean;
}

export interface ModelStats {
  total: number;
  draft: number;
  queue: number;
  running: number;
  completed: number;
  published: number;
  failed: number;
  cancelled: number;
  model_limit?: number;
  remaining?: number;
  is_unlimited?: boolean;
}

export interface ModelListResponse {
  success: boolean;
  data: Model[];
  total: number;
  limit: number;
  offset: number;
  server_time?: string;
}

export interface ModelResponse {
  success: boolean;
  data: Model;
  message?: string;
}

interface ModelStatsResponse {
  success: boolean;
  data: ModelStats;
}

class ModelService {
  private readonly baseURL = '/models';

  async createModel(data: CreateModelRequest): Promise<ModelResponse> {
    const response = await axios.post(this.baseURL, data);
    return response.data;
  }

  async getModels(params?: {
    limit?: number;
    offset?: number;
    search?: string;
    workspace_id?: number;
    sort_by?: string;
    sort_order?: string;
  }): Promise<ModelListResponse> {
    const response = await axios.get(this.baseURL, { params });
    return response.data;
  }

  async getModelById(id: number): Promise<ModelResponse> {
    const response = await axios.get(`${this.baseURL}/${id}`);
    return response.data;
  }

  async updateModel(id: number, data: UpdateModelRequest): Promise<ModelResponse> {
    const response = await axios.put(`${this.baseURL}/${id}`, data);
    return response.data;
  }

  async deleteModel(id: number): Promise<{ success: boolean; message: string }> {
    const response = await axios.delete(`${this.baseURL}/${id}`);
    return response.data;
  }

  async getModelStats(): Promise<ModelStatsResponse> {
    const response = await axios.get(`${this.baseURL}/stats`);
    return response.data;
  }

  async startCalculation(id: number): Promise<ModelResponse> {
    const response = await axios.post(`/calculation/start/${id}`);
    return response.data;
  }

  async downloadModelResults(id: number): Promise<AxiosResponse<Blob>> {
    return axios.get(`${this.baseURL}/${id}/download`, {
      responseType: 'blob',
    });
  }

  async updateModelActivation(id: number, isActive: boolean): Promise<ModelResponse> {
    const response = await axios.put(`${this.baseURL}/${id}/activation`, { is_active: isActive });
    return response.data;
  }

  async duplicateModel(id: number, cachedModels?: Model[]): Promise<ModelResponse> {
    // Fetch original model
    const originalResponse = await this.getModelById(id);
    if (!originalResponse.success) {
      throw new Error('Failed to fetch original simulation');
    }

    const original = originalResponse.data;

    // YYYY-MM-DD formatter
    const formatDate = (dateStr: string): string => {
      const date = new Date(dateStr);
      return date.toISOString().split('T')[0];
    };

    let groupId = original.group_id;
    let parentModelId: number;

    if (original.parent_model_id) {
      parentModelId = original.parent_model_id;
      groupId = groupId || original.parent_model_id;
    } else {
      parentModelId = original.id;
      groupId = groupId || original.id;
    }

    // Use cached models if available, otherwise fetch
    let allModels: Model[];
    if (cachedModels) {
      allModels = cachedModels;
    } else {
      const allModelsResponse = await this.getModels();
      if (!allModelsResponse.success) {
        throw new Error('Failed to fetch existing models for version calculation');
      }
      allModels = allModelsResponse.data;
    }

    // Extract base title safely without ReDoS vulnerability
    const baseTitle = extractBaseTitle(original.title);

    // Check if version part matches pattern " v<number>"
    const versionRegex = /^ v(\d{1,5})$/;
    const siblings = allModels.filter(model => {
      if (model.parent_model_id !== parentModelId) return false;
      if (!model.title.startsWith(baseTitle)) return false;

      const versionPart = model.title.slice(baseTitle.length);
      return versionRegex.test(versionPart);
    });

    // Find the maximum version number among siblings
    let maxVersion = 0;
    for (const sibling of siblings) {
      const versionPart = sibling.title.slice(baseTitle.length);
      const match = versionRegex.exec(versionPart);
      if (match) {
        const version = Number.parseInt(match[1], 10);
        if (version > maxVersion) {
          maxVersion = version;
        }
      }
    }

    const nextVersion = maxVersion + 1;
    const newTitle = `${baseTitle} v${nextVersion}`;

    const copyData: CreateModelRequest = {
      title: newTitle,
      description: original.description,
      workspace_id: original.workspace_id,
      region: original.region,
      country: original.country,
      coordinates: original.coordinates,
      selected_count: original.selected_count,
      resolution: original.resolution,
      from_date: formatDate(original.from_date),
      to_date: formatDate(original.to_date),
      config: original.config,
      group_id: groupId,
      parent_model_id: parentModelId,
      is_copy: true,
    };

    return this.createModel(copyData);
  }

  async moveModel(id: number, workspaceId: number): Promise<ModelResponse> {
    const response = await axios.patch(`${this.baseURL}/${id}/move`, {
      workspace_id: workspaceId,
    });
    return response.data;
  }

  async bulkMoveModels(modelIds: number[], workspaceId: number): Promise<{ success: boolean; message: string }> {
    const response = await axios.patch(`${this.baseURL}/bulk-move`, {
      model_ids: modelIds,
      workspace_id: workspaceId,
    });
    return response.data;
  }

  async shareModel(id: number, email: string): Promise<{ success: boolean; message: string }> {
    const response = await axios.post(`${this.baseURL}/${id}/share`, {
      email: email,
    });
    return response.data;
  }
}

export const modelService = new ModelService();
