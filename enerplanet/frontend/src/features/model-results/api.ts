import axios from 'axios';
import api from '@/lib/axios';
import { ModelInfo, ModelResults, StructuredModelResults, CarrierProdRecord, CarrierConRecord, CapacityFactorRecord, EnergyCapRecord, CostRecord, SystemBalanceRecord, UnmetDemandRecord, ResourceConRecord, LineFlowRecord, TransformerFlowRecord } from './types';

export async function fetchModelWithResults(modelId: number, signal?: AbortSignal): Promise<ModelInfo | null> {
  try {
    const response = await api.get(`/models/${modelId}`, { signal });
    if (response.data?.success && response.data?.data) {
      return response.data.data as ModelInfo;
    }
    return null;
  } catch (error) {
    if (axios.isCancel(error)) return null;
    console.error('Failed to fetch model:', error);
    return null;
  }
}


export async function fetchStructuredResults(modelId: number, signal?: AbortSignal): Promise<StructuredModelResults | null> {
  try {
    const response = await api.get(`/models/${modelId}/results/structured`, { signal });
    
    if (response.data?.success && response.data?.data) {
      return response.data.data as StructuredModelResults;
    }
    return null;
  } catch (error) {
    if (axios.isCancel(error)) return null;
    console.error('Failed to fetch structured results:', error);
    return null;
  }
}


export function convertStructuredToLegacy(structured: StructuredModelResults): ModelResults {
  
  const coordinates: Record<string, { x: number; y: number }> = {};
  for (const coord of structured.coordinates || []) {
    coordinates[coord.location] = { x: coord.x, y: coord.y };
  }

  
  const locTechs: Record<string, string[]> = {};
  for (const lt of structured.loc_techs || []) {
    if (!locTechs[lt.location]) {
      locTechs[lt.location] = [];
    }
    locTechs[lt.location].push(lt.tech);
  }

  
  const systemwideCapacityFactor = (structured.model_capacity_factor || []).map(cf => ({
    carrier: cf.carrier,
    techs: cf.techs,
    value: cf.value,
  }));

  
  const systemwideLevelisedCost = (structured.model_levelised_cost || []).map(lc => ({
    carrier: lc.carrier,
    costs: lc.costs,
    techs: lc.techs,
    value: lc.value,
  }));

  
  const totalLevelisedCost = (structured.model_total_levelised_cost || []).map(tlc => ({
    carrier: tlc.carrier,
    costs: tlc.costs,
    value: tlc.value,
  }));

  
  const energyCap = (structured.energy_cap || []).map(ec => ({
    location: ec.from_location,
    tech: ec.tech,
    to_loc: ec.to_location,
    value: ec.value,
  }));

  const prodAgg: Record<string, number> = {};
  (structured.prod_aggregates || []).forEach(a => {
    const base = (a.techs || '').split(':', 1)[0];
    prodAgg[base] = (prodAgg[base] || 0) + (a.total || 0);
  });

  const conAgg: Record<string, number> = {};
  (structured.con_aggregates || []).forEach(a => {
    const base = (a.techs || '').split(':', 1)[0];
    conAgg[base] = (conAgg[base] || 0) + (a.total || 0);
  });

  return {
    coordinates,
    loc_techs: locTechs,
    systemwide_capacity_factor: systemwideCapacityFactor,
    systemwide_levelised_cost: systemwideLevelisedCost,
    total_levelised_cost: totalLevelisedCost,
    energy_cap: energyCap,
    sum_production: structured.sum_production || 0,
    sum_consumption: structured.sum_consumption || 0,
    timestep_count: structured.timestep_count || 8760,
    prod_aggregates: prodAgg,
    con_aggregates: conAgg,
    pypsa: structured.pypsa,
  };
}


export interface LocationTimeSeriesData {
  location: string;
  production: CarrierProdRecord[];
  consumption: CarrierConRecord[];
  capacity_factor: CapacityFactorRecord[];
  energy_cap: EnergyCapRecord[];
  costs: CostRecord[];
  
  voltage?: { timestep: string; v_mag_pu: number; v_ang?: number; bus: string; location: string }[];
  power?: { timestep: string; p: number; q?: number; bus: string; location: string }[];
}


export async function fetchLocationTimeSeries(
  modelId: number,
  location: string,
  beginDate?: string,
  endDate?: string,
  signal?: AbortSignal
): Promise<LocationTimeSeriesData | null> {
  try {
    const params = new URLSearchParams();
    if (beginDate) params.append('begin', beginDate);
    if (endDate) params.append('end', endDate);
    
    const queryString = params.toString() ? `?${params.toString()}` : '';
    const response = await api.get(`/models/${modelId}/results/location/${encodeURIComponent(location)}${queryString}`, { signal });
    
    if (response.data?.success && response.data?.data) {
      return response.data.data as LocationTimeSeriesData;
    }
    return null;
  } catch (error) {
    if (axios.isCancel(error)) return null;
    console.error('Failed to fetch location time series:', error);
    return null;
  }
}


interface CarrierTimeSeriesData {
  carrier_prod: CarrierProdRecord[];
  carrier_con: CarrierConRecord[];
}

export async function fetchCarrierTimeSeries(
  modelId: number,
  options?: {
    beginDate?: string;
    endDate?: string;
    aggregate?: 'daily' | 'hourly';
    signal?: AbortSignal;
  }
): Promise<CarrierTimeSeriesData | null> {
  try {
    const params = new URLSearchParams();
    if (options?.beginDate) params.append('begin', options.beginDate);
    if (options?.endDate) params.append('end', options.endDate);
    if (options?.aggregate) params.append('aggregate', options.aggregate);

    const queryString = params.toString() ? `?${params.toString()}` : '';
    const response = await api.get(`/models/${modelId}/results/carrier-timeseries${queryString}`, { signal: options?.signal });

    if (response.data?.success && response.data?.data) {
      return response.data.data as CarrierTimeSeriesData;
    }
    return null;
  } catch (error) {
    if (axios.isCancel(error)) return null;
    console.error('Failed to fetch carrier time series:', error);
    return null;
  }
}


interface SystemTimeSeriesData {
  system_balance: SystemBalanceRecord[];
  unmet_demand: UnmetDemandRecord[];
  resource_con: ResourceConRecord[];
  line_flows: LineFlowRecord[];
  trafo_flows: TransformerFlowRecord[];
}

export async function fetchSystemTimeSeries(modelId: number, signal?: AbortSignal): Promise<SystemTimeSeriesData | null> {
  try {
    const response = await api.get(`/models/${modelId}/results/system-timeseries`, { signal });

    if (response.data?.success && response.data?.data) {
      return response.data.data as SystemTimeSeriesData;
    }
    return null;
  } catch (error) {
    if (axios.isCancel(error)) return null;
    console.error('Failed to fetch system time series:', error);
    return null;
  }
}


export interface PyPSAModelResults {
  voltage?: { timestep: string; v_mag_pu: number; v_ang?: number; bus: string; location: string }[];
  power?: { timestep: string; p: number; q?: number; bus: string; location: string }[];
  buses_t_v_mag_pu?: { timestep: string; v_mag_pu: number; v_ang?: number; bus: string; location: string }[];
  buses_t_p?: { timestep: string; p: number; q?: number; bus: string; location: string }[];
  line_loading?: {
    timestep: string;
    line: string;
    bus0: string;
    bus1: string;
    p0: number;
    p1?: number;
    q0?: number;
    q1?: number;
    loading_percent?: number;
  }[];
  transformer_flows?: TransformerFlowRecord[];
  transformer_loading?: {
    transformer: string;
    timestep: string;
    p0: number;
    p1: number;
    q0: number;
    q1: number;
    s_nom_kva: number;
  }[];
  curtailment?: {
    timestep: string;
    available_kw: number;
    actual_kw: number;
    curtailed_kw: number;
  }[];
  line_ratings?: Record<string, number>;
  convergence?: {
    validation_issues: string[];
    lpf_max_mismatch: number;
    pf_attempt: string;
    converged_snapshots: number;
    total_snapshots: number;
  };
  settings?: {
    volt_lv?: string;
    volt_mv?: string;
    trafo_type_mv_lv?: string;
    line_type_lv?: string;
    line_type_mv?: string;
    converged?: boolean;
  };
  locations: string[];
}


export async function fetchPyPSAResults(modelId: number, signal?: AbortSignal): Promise<PyPSAModelResults | null> {
  try {
    const response = await api.get(`/models/${modelId}/results/pypsa`, { signal });
    
    if (response.data?.success && response.data?.data) {
      return response.data.data as PyPSAModelResults;
    }
    return null;
  } catch (error) {
    if (axios.isCancel(error)) return null;
    console.error('Failed to fetch PyPSA results:', error);
    return null;
  }
}
