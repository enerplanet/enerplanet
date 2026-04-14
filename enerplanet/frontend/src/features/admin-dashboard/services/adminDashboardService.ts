import axios from '@/lib/axios';
import type { PylovoInstance, PylovoCreateData } from '@/features/admin-dashboard/types';

interface CountUsersResponse {
  success?: boolean;
  data?: {
    total?: number;
    online?: number;
  };
}

export async function getManagedUsersCount(): Promise<{ total: number; online: number }> {
  const { data } = await axios.get<CountUsersResponse>('/users/count');
  return {
    total: Number(data?.data?.total ?? 0),
    online: Number(data?.data?.online ?? 0),
  };
}

interface ApiResponse<T> {
  success: boolean;
  data: T;
}

export const pylovoApi = {
  async getAll(): Promise<PylovoInstance[]> {
    const { data } = await axios.get<ApiResponse<{ items: PylovoInstance[]; total: number }>>("/pylovo-services");
    if (data?.success && data.data?.items) {
      return data.data.items;
    }
    return [];
  },

  async getById(id: number): Promise<PylovoInstance> {
    const { data } = await axios.get<ApiResponse<PylovoInstance>>(`/pylovo-services/${id}`);
    return data.data;
  },

  async create(payload: PylovoCreateData): Promise<PylovoInstance> {
    const { data } = await axios.post<ApiResponse<PylovoInstance>>("/pylovo-services", payload);
    return data.data;
  },

  async update(id: number, payload: Partial<PylovoInstance>): Promise<PylovoInstance> {
    const { data } = await axios.put<ApiResponse<PylovoInstance>>(`/pylovo-services/${id}`, payload);
    return data.data;
  },

  async delete(id: number): Promise<void> {
    await axios.delete(`/pylovo-services/${id}`);
  },

  async setPrimary(id: number): Promise<PylovoInstance> {
    const { data } = await axios.post<ApiResponse<PylovoInstance>>(`/pylovo-services/${id}/primary`);
    return data.data;
  },

  async markAvailable(id: number): Promise<PylovoInstance> {
    const { data } = await axios.post<ApiResponse<PylovoInstance>>(`/pylovo-services/${id}/available`);
    return data.data;
  },

  async markUnavailable(id: number): Promise<PylovoInstance> {
    const { data } = await axios.post<ApiResponse<PylovoInstance>>(`/pylovo-services/${id}/unavailable`);
    return data.data;
  },

  async ping(id: number): Promise<{ available: boolean; details: Record<string, unknown> | null }> {
    const { data } = await axios.get<ApiResponse<{ available: boolean; details: Record<string, unknown> | null }>>(`/pylovo-services/${id}/ping`);
    return data.data;
  },

  async getSummary(): Promise<{ total: number; active: number; available: number }> {
    const { data } = await axios.get<ApiResponse<{ total: number; active: number; available: number }>>("/pylovo-services/summary");
    if (data?.success && data.data) {
      return data.data;
    }
    return { total: 0, active: 0, available: 0 };
  },
};
