import axios from "@/lib/axios";
import {
  WebserviceInstance,
  WebserviceCreateData,
  WebserviceFilters,
} from "@/features/admin-dashboard/types";

interface ApiResponse<T> {
  success: boolean;
  data: T;
}

const webserviceApi = {
  async getAll(filters?: WebserviceFilters): Promise<WebserviceInstance[]> {
    const { data } = await axios.get<ApiResponse<{ items: WebserviceInstance[]; total: number; page: number; per_page: number }>>("/webservices", { params: filters });
    if (data?.success && data.data?.items) {
      return data.data.items;
    }
    return [];
  },

  async getById(id: number): Promise<WebserviceInstance> {
    const { data } = await axios.get<ApiResponse<WebserviceInstance>>(`/webservices/${id}`);
    return data.data;
  },

  async create(payload: WebserviceCreateData): Promise<WebserviceInstance> {
    const { data } = await axios.post<ApiResponse<WebserviceInstance>>("/webservices", payload);
    return data.data;
  },

  async update(id: number, payload: Partial<WebserviceInstance>): Promise<WebserviceInstance> {
    const { data } = await axios.put<ApiResponse<WebserviceInstance>>(`/webservices/${id}`, payload);
    return data.data;
  },

  async delete(id: number): Promise<void> {
    await axios.delete(`/webservices/${id}`);
  },

  async markAvailable(id: number): Promise<WebserviceInstance> {
    const { data } = await axios.post<ApiResponse<WebserviceInstance>>(`/webservices/${id}/available`);
    return data.data;
  },

  async markUnavailable(id: number): Promise<WebserviceInstance> {
    const { data } = await axios.post<ApiResponse<WebserviceInstance>>(`/webservices/${id}/unavailable`);
    return data.data;
  },

  async markBusy(id: number): Promise<WebserviceInstance> {
    const { data } = await axios.post<ApiResponse<WebserviceInstance>>(`/webservices/${id}/busy`);
    return data.data;
  },

  async markIdle(id: number): Promise<WebserviceInstance> {
    const { data } = await axios.post<ApiResponse<WebserviceInstance>>(`/webservices/${id}/idle`);
    return data.data;
  },

  async checkHealth(id: number): Promise<{ healthy: boolean }> {
    const { data } = await axios.get<ApiResponse<{ healthy: boolean }>>(`/webservices/${id}/health`);
    return data.data;
  },

  async pingWebservice(id: number): Promise<{ available: boolean; details: Record<string, unknown> | null }> {
    const { data } = await axios.get<ApiResponse<{ available: boolean; details: Record<string, unknown> | null }>>(`/webservices/${id}/ping`);
    return data.data;
  },

  async getSummary(): Promise<{
    total: number;
    online: number;
    available: number;
    busy: number;
    offline: number;
  }> {
    const { data } = await axios.get<ApiResponse<{ total: number; active: number; available: number }>>("/webservices/summary");
    if (data?.success && data.data && typeof data.data === 'object' && 'total' in data.data) {
      const total = data.data.total || 0;
      const active = data.data.active || 0;
      const available = data.data.available || 0;
      const busy = 0;
      const offline = total - active;
      return { total, online: active, available, busy, offline };
    }
    return { total: 0, online: 0, available: 0, busy: 0, offline: 0 };
  },
};

import { useState, useCallback, useEffect, useMemo, useRef } from "react";

interface UseWebservicesOptions {
  autoRefresh?: boolean;
  refreshInterval?: number;
}

interface UseWebservicesReturn {
  webservices: WebserviceInstance[];
  loading: boolean;
  error: string | null;
  summary: {
    total: number;
    online: number;
    available: number;
    busy: number;
    offline: number;
  } | null;
  loadWebservices: (filters?: WebserviceFilters) => Promise<void>;
  createWebservice: (data: WebserviceCreateData) => Promise<WebserviceInstance>;
  updateWebservice: (id: number, data: Partial<WebserviceInstance>) => Promise<WebserviceInstance>;
  deleteWebservice: (id: number) => Promise<void>;
  markAvailable: (id: number) => Promise<WebserviceInstance>;
  markUnavailable: (id: number) => Promise<WebserviceInstance>;
  markBusy: (id: number) => Promise<WebserviceInstance>;
  markIdle: (id: number) => Promise<WebserviceInstance>;
  pingWebservice: (id: number) => Promise<{ available: boolean; details: Record<string, unknown> | null }>;
  checkHealth: (id: number) => Promise<{ healthy: boolean }>;
}

export const useWebservices = (
  initialFilters: WebserviceFilters = {},
  options: UseWebservicesOptions = {}
): UseWebservicesReturn => {
  const [webservices, setWebservices] = useState<WebserviceInstance[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [summary, setSummary] = useState<{
    total: number;
    online: number;
    available: number;
    busy: number;
    offline: number;
  } | null>(null);

  // Prevent overlapping loads and duplicated intervals
  const isLoadingRef = useRef(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Store initial filters & options in refs to keep them stable and avoid infinite reload loops when parent passes new object literals
  const stableFiltersRef = useRef(initialFilters);
  const stableOptionsRef = useRef(options);

  const computedSummary = useMemo(() => {
    if (!webservices.length) return null;

    return {
      total: webservices.length,
      online: webservices.filter(w => w.status === "active").length,
      available: webservices.filter(w => w.available).length,
      busy: webservices.filter(w => w.current_concurrency > 0).length,
      offline: webservices.filter(w => w.status === "inactive").length,
    };
  }, [webservices]);

  const loadWebservices = useCallback(async (filters?: WebserviceFilters) => {
    if (isLoadingRef.current) return;
    isLoadingRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const [data, summaryData] = await Promise.all([
        webserviceApi.getAll(filters),
        webserviceApi.getSummary().catch(() => null),
      ]);
      setWebservices(Array.isArray(data) ? data : []);

      if (summaryData) {
        setSummary(summaryData);
      } else {
        setSummary(null);
      }
    } catch (err: unknown) {
      const message = (typeof err === 'object' && err && 'message' in (err as Record<string, unknown>))
        ? String((err as { message?: unknown }).message)
        : 'Failed to load webservices';
      setError(message);
      setWebservices([]);
    } finally {
      setLoading(false);
      isLoadingRef.current = false;
    }
  }, []);

  const createWebservice = useCallback(async (data: WebserviceCreateData): Promise<WebserviceInstance> => {
    const response = await webserviceApi.create(data);
    setWebservices(prev => [...prev, response]);
    return response;
  }, []);

  const updateWebservice = useCallback(async (id: number, data: Partial<WebserviceInstance>): Promise<WebserviceInstance> => {
    const response = await webserviceApi.update(id, data);
    setWebservices(prev => prev.map(ws => ws.id === id ? response : ws));
    return response;
  }, []);

  const deleteWebservice = useCallback(async (id: number): Promise<void> => {
    await webserviceApi.delete(id);
    setWebservices(prev => prev.filter(ws => ws.id !== id));
  }, []);

  const markAvailable = useCallback(async (id: number): Promise<WebserviceInstance> => {
    const response = await webserviceApi.markAvailable(id);
    setWebservices(prev => prev.map(ws => ws.id === id ? response : ws));
    return response;
  }, []);

  const markUnavailable = useCallback(async (id: number): Promise<WebserviceInstance> => {
    const response = await webserviceApi.markUnavailable(id);
    setWebservices(prev => prev.map(ws => ws.id === id ? response : ws));
    return response;
  }, []);

  const markBusy = useCallback(async (id: number): Promise<WebserviceInstance> => {
    const response = await webserviceApi.markBusy(id);
    setWebservices(prev => prev.map(ws => ws.id === id ? response : ws));
    return response;
  }, []);

  const markIdle = useCallback(async (id: number): Promise<WebserviceInstance> => {
    const response = await webserviceApi.markIdle(id);
    setWebservices(prev => prev.map(ws => ws.id === id ? response : ws));
    return response;
  }, []);

  const checkHealth = useCallback(async (id: number): Promise<{ healthy: boolean }> => {
    const response = await webserviceApi.checkHealth(id);
    setWebservices(prev => prev.map(ws => {
      if (ws.id === id) {
        return {
          ...ws,
          status: response.healthy ? "active" as const : "inactive" as const,
          available: response.healthy
        };
      }
      return ws;
    }));
    return response;
  }, []);

  const pingWebservice = useCallback(async (id: number): Promise<{ available: boolean; details: Record<string, unknown> | null }> => {
    const response = await webserviceApi.pingWebservice(id);
    setWebservices(prev => prev.map(ws => {
      if (ws.id === id) {
        return {
          ...ws,
          status: response.available ? "active" as const : "inactive" as const,
          available: response.available
        };
      }
      return ws;
    }));
    return response;
  }, []);

  // Load data on mount
  useEffect(() => {
    loadWebservices(stableFiltersRef.current);
  }, [loadWebservices]);

  // Set up auto-refresh interval (deduplicated)
  const autoRefresh = stableOptionsRef.current.autoRefresh;
  const refreshInterval = stableOptionsRef.current.refreshInterval;
  useEffect(() => {
    // Clear any existing interval first
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    if (autoRefresh && refreshInterval) {
      intervalRef.current = globalThis.setInterval(() => {
        loadWebservices(stableFiltersRef.current);
      }, refreshInterval);
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [loadWebservices, autoRefresh, refreshInterval]);

  return {
    webservices,
    loading,
    error,
    summary: summary || computedSummary,
    loadWebservices,
    createWebservice,
    updateWebservice,
    deleteWebservice,
    markAvailable,
    markUnavailable,
    markBusy,
    markIdle,
    pingWebservice,
    checkHealth,
  };
};

