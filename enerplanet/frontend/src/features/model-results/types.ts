

interface Coordinate {
  x: number;
  y: number;
}

interface SystemwideCapacityFactor {
  carrier: string;
  techs: string;
  value: number;
}

interface SystemwideLevelisedCost {
  carrier: string;
  costs: string;
  techs: string;
  value: number;
}

interface TotalLevelisedCost {
  carrier: string;
  costs: string;
  value: number;
}

interface EnergyCap {
  location: string;
  tech: string;
  to_loc?: string;
  value: number;
}


export interface CapacityFactorRecord {
  id: number;
  model_id: number;
  from_location: string;
  to_location?: string;
  carrier: string;
  techs: string;
  timestep?: string;
  value: number;
}


export interface CarrierProdRecord {
  id: number;
  model_id: number;
  from_location: string;
  to_location?: string;
  carrier: string;
  techs: string;
  timestep: string;
  value: number;
}


export interface CarrierConRecord {
  id: number;
  model_id: number;
  from_location: string;
  to_location?: string;
  carrier: string;
  techs: string;
  timestep: string;
  value: number;
}


export interface CostRecord {
  id: number;
  model_id: number;
  from_location: string;
  to_location?: string;
  costs: string;
  techs: string;
  value: number;
}


export interface EnergyCapRecord {
  id: number;
  model_id: number;
  from_location: string;
  to_location?: string;
  tech: string;
  value: number;
}


interface ModelCapacityFactorRecord {
  id: number;
  model_id: number;
  carrier: string;
  techs: string;
  value: number;
}


interface ModelLevelisedCostRecord {
  id: number;
  model_id: number;
  carrier: string;
  costs: string;
  techs: string;
  value: number;
}


interface ModelTotalLevelisedCostRecord {
  id: number;
  model_id: number;
  carrier: string;
  costs: string;
  value: number;
}


interface CoordinateRecord {
  id: number;
  model_id: number;
  location: string;
  x: number;
  y: number;
}


interface LocTechRecord {
  id: number;
  model_id: number;
  location: string;
  tech: string;
}

interface PyPSAResults {
  volt_lv: string;
  volt_mv?: string;
  trafo_type_mv_lv?: string;
  line_type_lv: string;
  line_type_mv: string;
  converged: boolean;
}


export interface SystemBalanceRecord {
  id: number;
  model_id: number;
  carrier: string;
  location: string;
  timestep: string;
  value: number;
}


export interface UnmetDemandRecord {
  id: number;
  model_id: number;
  carrier: string;
  location: string;
  timestep: string;
  value: number;
}


export interface ResourceConRecord {
  id: number;
  model_id: number;
  location: string;
  tech: string;
  timestep: string;
  value: number;
}


export interface LineFlowRecord {
  id: number;
  model_id: number;
  line: string;
  timestep: string;
  p0: number;
  p1: number;
}


export interface TransformerFlowRecord {
  id: number;
  model_id: number;
  transformer: string;
  timestep: string;
  p0: number;
  p1: number;
}


interface CostInvestmentRecord {
  id: number;
  model_id: number;
  location: string;
  costs: string;
  techs: string;
  value: number;
}


export interface ModelResults {
  coordinates: Record<string, Coordinate>;
  loc_techs: Record<string, string[]>;
  systemwide_capacity_factor: SystemwideCapacityFactor[];
  systemwide_levelised_cost: SystemwideLevelisedCost[];
  total_levelised_cost: TotalLevelisedCost[];
  energy_cap: EnergyCap[];
  sum_production: number;
  sum_consumption: number;
  timestep_count?: number;
  prod_aggregates?: Record<string, number>;
  con_aggregates?: Record<string, number>;
  pypsa?: PyPSAResults;
}

// ---------------------------------------------------------------------------
// Energy carrier (heat support)
// ---------------------------------------------------------------------------

/**
 * Energy carrier bucket label as it appears in result records. Follows
 * Calliope conventions nominally — "power" is electricity, "heat" the
 * secondary carrier. NOT a hard enum: the backend may deliver other labels
 * ("thermal", etc.); treat values as opaque data and only map to display
 * labels via CARRIER_LABELS.
 */
export type EnergyCarrier = string;

export const CARRIER_LABELS: Record<string, string> = {
  power: 'results.carrier.electricity',
  electricity: 'results.carrier.electricity',
  heat: 'results.carrier.heat',
  thermal: 'results.carrier.heat',
};

/** Summary block per carrier, served by the backend structured endpoint. */
export interface CarrierSummary {
  sum_production: number;
  sum_consumption: number;
  renewable_production: number;
  grid_import: number;
  peak_demand: number;
  timestep_count: number;
  prod_aggregates: Array<{ techs: string; total: number }>;
  con_aggregates: Array<{ techs: string; total: number }>;
}

export interface StructuredModelResults {
  coordinates: CoordinateRecord[];
  loc_techs: LocTechRecord[];
  model_capacity_factor: ModelCapacityFactorRecord[];
  model_levelised_cost: ModelLevelisedCostRecord[];
  model_total_levelised_cost: ModelTotalLevelisedCostRecord[];
  energy_cap: EnergyCapRecord[];
  cost: CostRecord[];
  cost_investment: CostInvestmentRecord[];
  sum_production: number;
  sum_consumption: number;
  renewable_production: number;
  grid_import: number;
  peak_demand: number;
  timestep_count: number;
  prod_aggregates?: Array<{ techs: string; total: number }>;
  con_aggregates?: Array<{ techs: string; total: number }>;
  /**
   * Per-carrier summaries (backend serves all carriers when no ?carrier= is
   * sent). Keyed by the raw carrier label from the webservice output
   * ("power", "heat", possibly "thermal") — do not assume the set.
   */
  carrier_summaries?: Record<string, CarrierSummary>;
  carrier_prod?: CarrierProdRecord[];
  carrier_con?: CarrierConRecord[];
  system_balance?: SystemBalanceRecord[];
  unmet_demand?: UnmetDemandRecord[];
  resource_con?: ResourceConRecord[];
  line_flows?: LineFlowRecord[];
  trafo_flows?: TransformerFlowRecord[];
  pypsa?: PyPSAResults;
}

interface MultiPolygonGeometry {
  type: 'MultiPolygon';
  coordinates: [number, number][][][];
}

interface GeoJSONFeatureCollection {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    geometry: {
      type: string;
      coordinates: unknown;
    };
    properties: Record<string, unknown>;
  }>;
}

interface ModelConfig {
  buildings?: GeoJSONFeatureCollection;
  lines?: GeoJSONFeatureCollection;
  mv_lines?: GeoJSONFeatureCollection;
  transformers?: GeoJSONFeatureCollection;
  grids?: unknown[];
  pypsa?: Record<string, unknown>;
}

export interface ModelInfo {
  id: number;
  title: string;
  description?: string;
  status: string;
  region?: string;
  country?: string;
  resolution?: number;
  from_date: string;
  to_date: string;
  created_at: string;
  updated_at: string;
  results?: ModelResults;
  coordinates?: MultiPolygonGeometry;
  config?: ModelConfig;
  workspace?: {
    id: number;
    name: string;
    description?: string;
  };
}

// Chart data types for visualization




