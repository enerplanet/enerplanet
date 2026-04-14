import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { pylovoApi } from "@/features/admin-dashboard/services/adminDashboardService";
import type { PylovoInstance, PylovoCreateData, PylovoFilters } from "@/features/admin-dashboard/types";

interface UsePylovoOptions {
  autoRefresh?: boolean;
  refreshInterval?: number;
}

interface UsePylovoReturn {
  instances: PylovoInstance[];
  loading: boolean;
  error: string | null;
  summary: {
    total: number;
    online: number;
    available: number;
    offline: number;
  } | null;
  loadInstances: (filters?: PylovoFilters) => Promise<void>;
  createInstance: (data: PylovoCreateData) => Promise<PylovoInstance>;
  updateInstance: (id: number, data: Partial<PylovoInstance>) => Promise<PylovoInstance>;
  deleteInstance: (id: number) => Promise<void>;
  setPrimary: (id: number) => Promise<PylovoInstance>;
  markAvailable: (id: number) => Promise<PylovoInstance>;
  markUnavailable: (id: number) => Promise<PylovoInstance>;
  pingInstance: (id: number) => Promise<{ available: boolean; details: Record<string, unknown> | null }>;
}

export const usePylovo = (
  _initialFilters: PylovoFilters = {},
  options: UsePylovoOptions = {}
): UsePylovoReturn => {
  const [instances, setInstances] = useState<PylovoInstance[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [summary, setSummary] = useState<{
    total: number;
    online: number;
    available: number;
    offline: number;
  } | null>(null);

  const isLoadingRef = useRef(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stableOptionsRef = useRef(options);

  const computedSummary = useMemo(() => {
    if (!instances.length) return null;
    return {
      total: instances.length,
      online: instances.filter(i => i.status === "active").length,
      available: instances.filter(i => i.available).length,
      offline: instances.filter(i => i.status === "inactive").length,
    };
  }, [instances]);

  const loadInstances = useCallback(async () => {
    if (isLoadingRef.current) return;
    isLoadingRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const [data, summaryData] = await Promise.all([
        pylovoApi.getAll(),
        pylovoApi.getSummary().catch(() => null),
      ]);
      setInstances(Array.isArray(data) ? data : []);

      if (summaryData) {
        const total = summaryData.total || 0;
        const active = summaryData.active || 0;
        const available = summaryData.available || 0;
        setSummary({ total, online: active, available, offline: total - active });
      } else {
        setSummary(null);
      }
    } catch (err: unknown) {
      const message = (typeof err === 'object' && err && 'message' in (err as Record<string, unknown>))
        ? String((err as { message?: unknown }).message)
        : 'Failed to load pylovo instances';
      setError(message);
      setInstances([]);
    } finally {
      setLoading(false);
      isLoadingRef.current = false;
    }
  }, []);

  const createInstance = useCallback(async (data: PylovoCreateData): Promise<PylovoInstance> => {
    const response = await pylovoApi.create(data);
    setInstances(prev => [...prev, response]);
    return response;
  }, []);

  const updateInstance = useCallback(async (id: number, data: Partial<PylovoInstance>): Promise<PylovoInstance> => {
    const response = await pylovoApi.update(id, data);
    setInstances(prev => prev.map(i => i.id === id ? response : i));
    return response;
  }, []);

  const deleteInstance = useCallback(async (id: number): Promise<void> => {
    await pylovoApi.delete(id);
    setInstances(prev => prev.filter(i => i.id !== id));
  }, []);

  const setPrimary = useCallback(async (id: number): Promise<PylovoInstance> => {
    const response = await pylovoApi.setPrimary(id);
    setInstances(prev => prev.map(i => ({
      ...i,
      is_primary: i.id === id,
    })));
    return response;
  }, []);

  const markAvailable = useCallback(async (id: number): Promise<PylovoInstance> => {
    const response = await pylovoApi.markAvailable(id);
    setInstances(prev => prev.map(i => i.id === id ? response : i));
    return response;
  }, []);

  const markUnavailable = useCallback(async (id: number): Promise<PylovoInstance> => {
    const response = await pylovoApi.markUnavailable(id);
    setInstances(prev => prev.map(i => i.id === id ? response : i));
    return response;
  }, []);

  const pingInstance = useCallback(async (id: number): Promise<{ available: boolean; details: Record<string, unknown> | null }> => {
    const response = await pylovoApi.ping(id);
    setInstances(prev => prev.map(i => {
      if (i.id === id) {
        return {
          ...i,
          status: response.available ? "active" as const : "inactive" as const,
          available: response.available,
        };
      }
      return i;
    }));
    return response;
  }, []);

  useEffect(() => {
    loadInstances();
  }, [loadInstances]);

  const autoRefresh = stableOptionsRef.current.autoRefresh;
  const refreshInterval = stableOptionsRef.current.refreshInterval;
  useEffect(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    if (autoRefresh && refreshInterval) {
      intervalRef.current = globalThis.setInterval(() => {
        loadInstances();
      }, refreshInterval);
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [loadInstances, autoRefresh, refreshInterval]);

  return {
    instances,
    loading,
    error,
    summary: summary || computedSummary,
    loadInstances,
    createInstance,
    updateInstance,
    deleteInstance,
    setPrimary,
    markAvailable,
    markUnavailable,
    pingInstance,
  };
};
