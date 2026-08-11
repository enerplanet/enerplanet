import type { PylovoGridData } from "../../configurator/types/area-select";
import type { NodeStatus } from "./workflow";

/**
 * Shared data contract for the modular workflow system.
 *
 * Every module reads its inputs from this context and writes its outputs back
 * into it. The context is the single source of truth that flows between
 * workflow steps, so modules never pass data to each other directly — they
 * only ever talk to the context.
 */

export type DataSource = "estimated" | "uploaded";

export interface DataSources {
  buildingDemand?: DataSource;
  timeSeries?: DataSource;
  gridData?: DataSource;
  technologies?: DataSource;
}

export interface GridStatistics {
  buildings: {
    count: number;
    total_area_m2: number;
    avg_area_m2: number;
    total_peak_load_kw: number;
    avg_peak_load_kw: number;
    simultaneous_load_kw: number;
    building_types: { type: string; count: number; total_peak_kw: number }[];
  };
  transformers: {
    count: number;
    total_capacity_kva: number;
    avg_capacity_kva: number;
    min_capacity_kva: number | null;
    max_capacity_kva: number | null;
    utilization_percent: number;
  };
  cables: {
    count: number;
    total_length_km: number;
    avg_length_km: number;
    cable_types: { type: string; count: number; length_km: number; cost_eur: number }[];
  };
  costs: {
    cable_cost_eur: number;
    transformer_cost_eur: number;
    total_estimated_cost_eur: number;
  };
  voltage: {
    nominal_voltage_v: number;
    voltage_band_low: number;
    voltage_band_high: number;
  };
}

export interface PowerFlowResponse {
  status: string;
  grid_result_id: number;
  load_scaling: number;
  converged: boolean;
  message?: string;
  network_info?: {
    buses: number;
    lines: number;
    loads: number;
    total_load_mw: number;
    trafo_capacity_mw: number;
    load_to_capacity_ratio: number;
  };
  summary?: {
    min_voltage_pu: number;
    max_voltage_pu: number;
    max_line_loading_percent: number;
    max_trafo_loading_percent: number;
    total_losses_kw: number;
    voltage_violations_count: number;
    overloaded_lines_count: number;
  };
  violations?: {
    voltage: { bus_id: number; name: string; vm_pu: number; violation: "undervoltage" | "overvoltage" }[];
    overloaded_lines: { line_id: number; name: string; loading_percent: number }[];
  };
}

export interface HostingCapacityResult {
  hosting_capacity_kw?: number;
  max_evs?: number;
  [key: string]: unknown;
}

export interface CostBreakdownItem {
  category: string;
  label: string;
  amount: number;
  [key: string]: unknown;
}

export interface BuildingEnergyEstimate {
  buildingType: string;
  fClass: string;
  area: number;
  householdSize?: number;
  estimatedHouseholds?: number;
  peakLoadKw: number;
  yearlyConsumptionKwh: number;
  source: "pylovo";
}

export interface GridAssignment {
  buildingId: number;
  transformerId: number;
  [key: string]: unknown;
}

export interface Technology {
  id: string;
  name: string;
  type: string;
  [key: string]: unknown;
}

export interface BuildingFilters {
  includePublic: boolean;
  includePrivate: boolean;
  excludedIds: Set<number>;
}

/**
 * Scenario type used by the simulation-settings module.
 *
 * Defined here alongside `SimulationSettings` to avoid a circular dependency
 * (the module imports `ConfiguratorContext`).
 */
export type ScenarioType = "season" | "duration" | "calliope";

/**
 * Simulation settings produced by the `simulation-settings` module.
 *
 * Defined here (rather than imported from the module) to avoid a circular
 * dependency: the module imports `ConfiguratorContext`.
 */
export interface SimulationSettings {
  modelName: string;
  scenario: { type: ScenarioType; value: string };
  fromDate: string;
  toDate: string;
  line_type_lv: string;
  line_type_mv: string;
  co2_limit: number;
  max_hours: number;
  autarky: number;
  pypsa_enabled: boolean;
}

export interface ConfiguratorContext {
  // Workflow metadata
  workflowId?: string;
  workflowVersion?: number;
  startType?: "from-scratch" | "from-existing-model";
  sourceModelId?: number;

  // Node-network state (Phase 2)
  /** Per-node completion/readiness state, keyed by node id. */
  nodeStates?: Record<string, NodeStatus>;
  /** The currently active node id. */
  activeNodeId?: string;
  /** Serializable snapshot for persistence (a later phase serializes this). */
  flowSnapshot?: {
    workflowId: string;
    workflowVersion?: number;
    context: Partial<ConfiguratorContext>;
    nodeStates: Record<string, NodeStatus>;
    savedAt: string;
  };

  // Data source flags — every data field can be "estimated" or "uploaded"
  dataSources?: DataSources;

  // Previous context snapshot for automatic diffing
  previousContext?: Partial<ConfiguratorContext>;

  // Region & Area
  region?: { country: string; state: string; boundary?: GeoJSON.Feature };
  polygons?: [number, number][][];

  // Grid
  gridData?: PylovoGridData;
  gridResultIds?: number[];
  gridStatistics?: GridStatistics;

  // Buildings & Demand
  buildingEstimates?: Map<string | number, BuildingEnergyEstimate>;
  buildingFilters?: BuildingFilters;

  // Transformers & Topology
  transformers?: GeoJSON.FeatureCollection;
  transformerAssignments?: GridAssignment[];

  // Technologies
  technologies?: Technology[];
  techParameters?: Record<string, unknown>;
  // Advanced Parameters (legacy — kept for backward compat with modules that
  // still write to it; new code should use `simulationSettings` instead)
  advancedParams?: Record<string, unknown>;

  // Simulation Settings (modular replacement for advancedParams)
  simulationSettings?: SimulationSettings;


  // Simulation Results
  powerFlowResult?: PowerFlowResponse;
  hostingCapacity?: HostingCapacityResult;

  // Pipeline
  pipelineJob?: { job_id: string; status: string; message: string };

  // Cost & Optimization
  costBreakdown?: CostBreakdownItem[];

  // Model YAML — full serialised model definition for expert diff/edit
  modelYaml?: string;
  previousModelYaml?: string;
  modelYamlEditMode?: boolean;

  // UI state
  uiMode?: "basic" | "expert";

  // Model Metadata
  modelName?: string;
  modelId?: number;
  workspaceId?: number;
  draftId?: string;

  /** The original model fetched at load time — used for change detection in edit mode. */
  originalModel?: {
    title?: string;
    from_date?: string;
    to_date?: string;
    resolution?: number;
    config?: Record<string, unknown>;
  } | null;
}
