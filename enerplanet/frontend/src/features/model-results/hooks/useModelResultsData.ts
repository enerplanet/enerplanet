import { useEffect, useState } from 'react';
import {
  fetchModelWithResults,
  fetchStructuredResults,
  convertStructuredToLegacy,
  fetchPyPSAResults,
  PyPSAModelResults,
} from '@/features/model-results/api';
import { ModelInfo, ModelResults, StructuredModelResults } from '@/features/model-results/types';
import technologyService from '@/features/technologies/services/technologyService';
import { modelService, Model } from '@/features/model-dashboard/services/modelService';
import { Workspace } from '@/components/workspace/services/workspaceService';

// Wind turbine data interface
export interface WindTurbineInfo {
  nominal_power: number;
  hub_height: number[];
  rotor_diameter: number;
  turbine_id: number;
}

/**
 * Custom hook for click outside detection
 */
export const useClickOutside = (
  ref: React.RefObject<HTMLElement | null>,
  isOpen: boolean,
  onClose: () => void
) => {
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [ref, isOpen, onClose]);
};

/**
 * Custom hook for loading wind turbine data from technology service
 */
export const useTurbineData = () => {
  const [turbineData, setTurbineData] = useState<Record<string, WindTurbineInfo>>({});

  useEffect(() => {
    const loadTurbineData = async () => {
      try {
        const technologies = await technologyService.getAll();
        const windTech = technologies.find(t => t.key === 'wind_onshore');
        if (windTech) {
          const turbineConstraint = windTech.constraints.find(c => c.key === 'turbine_id');
          if (turbineConstraint?.relationData && typeof turbineConstraint.relationData === 'object') {
            setTurbineData(turbineConstraint.relationData as Record<string, WindTurbineInfo>);
          }
        }
      } catch (err) {
        console.error('Failed to load turbine data from API:', err);
      }
    };
    loadTurbineData();
  }, []);

  return turbineData;
};

/**
 * Custom hook for loading completed models filtered by workspace
 */
export const useCompletedModels = (currentWorkspace: Workspace | null) => {
  const [completedModels, setCompletedModels] = useState<Model[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(false);

  useEffect(() => {
    const loadCompletedModels = async () => {
      setIsLoadingModels(true);
      try {
        const params: { workspace_id?: number } = {};
        if (currentWorkspace?.id) {
          params.workspace_id = currentWorkspace.id;
        }
        const response = await modelService.getModels(params);
        if (response.success) {
          const completed = response.data.filter(m => m.status === 'completed');
          setCompletedModels(completed);
        }
      } catch (err) {
        console.error('Failed to load models:', err);
        setCompletedModels([]);
      } finally {
        setIsLoadingModels(false);
      }
    };
    loadCompletedModels();
  }, [currentWorkspace]);

  return { completedModels, isLoadingModels };
};

/**
 * Custom hook for loading model data including results and PyPSA data
 */
export const useModelData = (modelId: number | null) => {
  const [model, setModel] = useState<ModelInfo | null>(null);
  const [results, setResults] = useState<ModelResults | null>(null);
  const [structuredResults, setStructuredResults] = useState<StructuredModelResults | null>(null);
  const [pypsaData, setPypsaData] = useState<PyPSAModelResults | null>(null);
  const [selectedBus, setSelectedBus] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [initialWorkspace, setInitialWorkspace] = useState<Workspace | null>(null);

  useEffect(() => {
    if (!modelId) {
      setError('Invalid model ID');
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    let cancelled = false;

    const loadData = async () => {
      try {
        setLoading(true);
        setError(null);

        // Run all three independent requests in parallel
        const [modelData, structuredData, pypsa] = await Promise.all([
          fetchModelWithResults(modelId, controller.signal),
          fetchStructuredResults(modelId, controller.signal),
          fetchPyPSAResults(modelId, controller.signal),
        ]);

        if (cancelled) return;

        if (modelData) {
          setModel(modelData);
          if (modelData.workspace) {
            setInitialWorkspace(modelData.workspace as unknown as Workspace);
          }
        }

        if (structuredData) {
          setStructuredResults(structuredData);
          const legacyResults = convertStructuredToLegacy(structuredData);
          setResults(legacyResults);
        }

        if (pypsa) {
          setPypsaData(pypsa);
          if (pypsa.locations?.length > 0) {
            setSelectedBus(pypsa.locations[0]);
          }
        }

        if (!modelData) setError('Model not found');
      } catch (err) {
        if (cancelled) return;
        console.error('Failed to load model data:', err);
        setError('Failed to load simulation results');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    loadData();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [modelId]);

  return {
    model,
    results,
    structuredResults,
    pypsaData,
    selectedBus,
    setSelectedBus,
    loading,
    error,
    initialWorkspace,
  };
};
