import axios from "@/lib/axios";

interface PylovoGridResponse {
    status: string;
    buildings: GeoJSON.FeatureCollection;
    transformers: GeoJSON.FeatureCollection;
    lines: GeoJSON.FeatureCollection;
    grids: GridInfo[];
}

interface GridInfo {
    grid_result_id: number;
    kcid: number;
    bcid: number;
    plz: string;
    transformer_rated_power: number;
}

interface TransformerSize {
    kva: number;
    cost_eur: number;
    type?: string;
    name?: string;
}

interface ConsumerCategory {
    id: number;
    definition: string;
    peak_load_kw: number | null;
    yearly_consumption_kwh: number | null;
    peak_load_per_m2: number | null;
    yearly_consumption_per_m2: number | null;
    sim_factor: number;
}

interface CableType {
    name: string;
    cost_eur_per_m: number;
    max_current_a?: number;
    resistance_ohm_per_km?: number;
    reactance_ohm_per_km?: number;
    capacitance_nf_per_km?: number;
    cross_section_mm2?: number;
}

interface BuildingTypeStats {
    type: string;
    count: number;
    total_peak_kw: number;
}

interface CableTypeStats {
    type: string;
    count: number;
    length_km: number;
    cost_eur: number;
}

interface GridStatistics {
    buildings: {
        count: number;
        total_area_m2: number;
        avg_area_m2: number;
        total_peak_load_kw: number;
        avg_peak_load_kw: number;
        simultaneous_load_kw: number;
        building_types: BuildingTypeStats[];
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
        cable_types: CableTypeStats[];
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

interface VoltageViolation {
    bus_id: number;
    name: string;
    vm_pu: number;
    violation: "undervoltage" | "overvoltage";
}

interface OverloadedLine {
    line_id: number;
    name: string;
    loading_percent: number;
}

interface BusResult {
    bus_id: number;
    name: string;
    vm_pu: number;
    va_degree: number;
    p_mw: number;
    q_mvar: number;
}

interface LineResult {
    line_id: number;
    name: string;
    loading_percent: number;
    i_ka: number;
    p_from_mw: number;
    p_to_mw: number;
    pl_mw: number;
    ql_mvar: number;
}

interface TrafoResult {
    trafo_id: number;
    name: string;
    loading_percent: number;
    i_hv_ka: number;
    i_lv_ka: number;
    p_hv_mw: number;
    p_lv_mw: number;
    pl_mw: number;
}

interface PowerFlowResponse {
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
        root_bus_id?: number;
        unique_buses_in_db?: number;
        leaf_buses_count?: number;
        lines_in_db?: number;
        loads_in_db?: number;
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
        voltage: VoltageViolation[];
        overloaded_lines: OverloadedLine[];
    };
    results?: {
        buses: BusResult[];
        lines: LineResult[];
        transformers: TrafoResult[];
    } | null;
}

interface VoltageSettings {
    nominal_voltage_v: number;
    voltage_band_low_pu: number;
    voltage_band_high_pu: number;
    min_voltage_v: number;
    max_voltage_v: number;
}

interface EquipmentItem {
    name: string;
    s_max_kva?: number;
    i_max_a?: number;
    cost_eur?: number;
    cross_section_mm2?: number;
}

interface EquipmentCosts {
    [category: string]: EquipmentItem[];
}

// Shared in-flight promise to deduplicate concurrent getAvailableRegions calls
let _availableRegionsPromise: Promise<any> | null = null;
let _availableRegionsCache: { data: any; timestamp: number } | null = null;
const _REGIONS_CACHE_TTL = 60_000; // 1 minute

export const pylovoService = {
    generateGrid: async (payload: {
        geom?: GeoJSON.Polygon | GeoJSON.MultiPolygon;
        polygon?: number[][];
        polygons?: number[][][];
        user_id?: string;
        model_id?: number;  // Model ID for filtering user-placed transformers (existing models)
        draft_id?: string;  // Draft ID for new models before saving
        include_public_buildings?: boolean;
        include_private_buildings?: boolean;
        excluded_building_ids?: number[];
    }): Promise<PylovoGridResponse> => {
        // Support both new format (geom) and old format (polygon/polygons)
        let requestPayload: {
            geom: GeoJSON.Polygon | GeoJSON.MultiPolygon;
            user_id?: string;
            model_id?: number;
            draft_id?: string;
            include_public_buildings?: boolean;
            include_private_buildings?: boolean;
            excluded_building_ids?: number[];
        };

        // Filter out null/empty polygons
        const validPolygons = payload.polygons?.filter(p => p && Array.isArray(p) && p.length > 0) || [];
        const validPolygon = payload.polygon && Array.isArray(payload.polygon) && payload.polygon.length > 0 ? payload.polygon : null;

        if (payload.geom) {
            requestPayload = { geom: payload.geom };
        } else if (validPolygons.length > 0) {
            // Convert old format to GeoJSON - use polygons array
            if (validPolygons.length === 1) {
                requestPayload = {
                    geom: {
                        type: "Polygon",
                        coordinates: [validPolygons[0]]
                    }
                };
            } else {
                requestPayload = {
                    geom: {
                        type: "MultiPolygon",
                        coordinates: validPolygons.map(p => [p])
                    }
                };
            }
        } else if (validPolygon) {
            requestPayload = {
                geom: {
                    type: "Polygon",
                    coordinates: [validPolygon]
                }
            };
        } else {
            console.error("Invalid payload:", payload);
            throw new Error("Invalid payload: must provide either geom or polygon/polygons with valid coordinates");
        }

        // Include user_id for custom buildings filtering
        if (payload.user_id) {
            requestPayload.user_id = payload.user_id;
        }
        
        // Include model_id for user-placed transformers filtering (existing models)
        if (payload.model_id) {
            requestPayload.model_id = payload.model_id;
        }
        
        // Include draft_id for user-placed transformers (new models before saving)
        if (payload.draft_id) {
            requestPayload.draft_id = payload.draft_id;
        }

        // Include custom building filter options
        if (payload.include_public_buildings !== undefined) {
            requestPayload.include_public_buildings = payload.include_public_buildings;
        }
        if (payload.include_private_buildings !== undefined) {
            requestPayload.include_private_buildings = payload.include_private_buildings;
        }
        if (payload.excluded_building_ids && payload.excluded_building_ids.length > 0) {
            requestPayload.excluded_building_ids = payload.excluded_building_ids;
        }

        const response = await axios.post<{ success: boolean; data: PylovoGridResponse }>("/v2/pylovo/generate-grid", requestPayload, {
            timeout: 0 // no timeout; large models (750+ buildings) need unlimited time
        });
        // Backend wraps response in {success: true, data: ...}
        return response.data.data;
    },

    getTransformerSizes: async (): Promise<TransformerSize[]> => {
        const response = await axios.get<{ data: { sizes: TransformerSize[]; count: number } }>("/v2/pylovo/transformer-sizes");
        return response.data?.data?.sizes || [];
    },

    getConsumerCategories: async (): Promise<ConsumerCategory[]> => {
        const response = await axios.get<{ data: { categories: ConsumerCategory[]; count: number } }>("/v2/pylovo/consumer-categories");
        return response.data?.data?.categories || [];
    },

    getConsumerCategoryNames: async (): Promise<string[]> => {
        const categories = await pylovoService.getConsumerCategories();
        return categories.map(c => c.definition);
    },

    getCableTypes: async (): Promise<{ cables: CableType[]; cable_costs: CableType[] }> => {
        const response = await axios.get<{ data: { cables: CableType[]; cable_costs: CableType[]; count: number } }>("/v2/pylovo/cable-types");
        return {
            cables: response.data?.data?.cables || [],
            cable_costs: response.data?.data?.cable_costs || []
        };
    },

    getGridStatistics: async (gridResultIds: number[]): Promise<GridStatistics> => {
        const response = await axios.post<{ data: { statistics: GridStatistics; grid_result_ids: number[] } }>(
            "/v2/pylovo/grid-statistics",
            { grid_result_ids: gridResultIds },
            { timeout: 0 } // no timeout; large models need unlimited time
        );
        return response.data?.data?.statistics || {} as GridStatistics;
    },

    runPowerFlow: async (gridResultId: number, loadScaling: number = 1, buildingOsmIds?: string[]): Promise<PowerFlowResponse> => {
        const response = await axios.post<{ data: PowerFlowResponse }>(
            "/v2/pylovo/power-flow",
            { 
                grid_result_id: gridResultId, 
                load_scaling: loadScaling,
                building_osm_ids: buildingOsmIds 
            },
            { timeout: 0 } // no timeout; large models need unlimited time
        );
        return response.data?.data || {} as PowerFlowResponse;
    },

    getEquipmentCosts: async (): Promise<EquipmentCosts> => {
        const response = await axios.get<{ data: { equipment: EquipmentCosts } }>("/v2/pylovo/equipment-costs");
        return response.data?.data?.equipment || {};
    },

    getVoltageSettings: async (): Promise<VoltageSettings> => {
        const response = await axios.get<{ data: { settings: VoltageSettings } }>("/v2/pylovo/voltage-settings");
        return response.data?.data?.settings || {} as VoltageSettings;
    },

    addCustomBuilding: async (payload: {
        title: string;
        f_class: string;
        area: number;
        demand_energy: number;
        geometry: GeoJSON.Point;
        geometry_area: GeoJSON.Polygon;
        is_public?: boolean;
        icon?: string;
    }): Promise<{ building_id: number; message: string }> => {
        const response = await axios.post<{ data: { building: { id: number }; status: string } }>(
            "/v2/pylovo/custom-buildings",
            payload
        );
        // The API returns { status: "success", building: { id: ... } }
        const buildingId = response.data?.data?.building?.id;
        return { building_id: buildingId || 0, message: response.data?.data?.status || '' };
    },

    getCustomBuildings: async (): Promise<CustomBuilding[]> => {
        const response = await axios.get<{ data: { buildings: CustomBuilding[]; count: number } }>(
            "/v2/pylovo/custom-buildings"
        );
        return response.data?.data?.buildings || [];
    },

    deleteCustomBuilding: async (buildingId: number): Promise<void> => {
        await axios.delete(`/v2/pylovo/custom-buildings/${buildingId}`);
    },

    runPipeline: async (payload: {
        country: string;
        state: string;
        step: 'datapipeline' | 'constructor' | 'grid' | 'all';
        workers?: number;
        no_cache?: boolean;
    }): Promise<{ job_id: string; status: string; message: string }> => {
        const response = await axios.post<{ data: { job_id: string; status: string; message: string } }>(
            "/v2/pylovo/pipeline/run",
            payload,
            { timeout: 0 } // no timeout; large models need unlimited time
        );
        return response.data?.data || { job_id: '', status: '', message: '' };
    },

    getPipelineStatus: async (jobId: string): Promise<{
        job_id: string;
        status: 'pending' | 'running' | 'completed' | 'failed';
        step: string;
        progress: number;
        logs: string[];
        started_at?: string;
        completed_at?: string;
        error?: string;
    }> => {
        const response = await axios.get<{ data: {
            job_id: string;
            status: 'pending' | 'running' | 'completed' | 'failed';
            step: string;
            progress: number;
            logs: string[];
            started_at?: string;
            completed_at?: string;
            error?: string;
        } }>(`/v2/pylovo/pipeline/status/${jobId}`);
        return response.data?.data || { job_id: '', status: 'pending', step: '', progress: 0, logs: [] };
    },

    getPipelineHistory: async (limit?: number): Promise<Array<{
        job_id: string;
        country: string;
        state: string;
        step: string;
        status: string;
        started_at: string;
        completed_at?: string;
        error?: string;
    }>> => {
        const response = await axios.get<{ data: { jobs: Array<{
            job_id: string;
            country: string;
            state: string;
            step: string;
            status: string;
            started_at: string;
            completed_at?: string;
            error?: string;
        }> } }>(`/v2/pylovo/pipeline/history` + (limit ? `?limit=${String(limit)}` : ''));
        return response.data?.data?.jobs || [];
    },

    getBoundary: async (lat: number, lon: number, adminLevel: number = 4): Promise<{
        status: string;
        region?: {
            name: string;
            admin_level: number;
            country?: string;
            country_code?: string;
            osm_id?: number;
        };
        boundary?: GeoJSON.Feature;
        message?: string;
    }> => {
        const response = await axios.get<{ data: {
            status: string;
            region?: {
                name: string;
                admin_level: number;
                country?: string;
                country_code?: string;
                osm_id?: number;
            };
            boundary?: GeoJSON.Feature;
            message?: string;
        } }>(`/v2/pylovo/boundary?lat=${lat}&lon=${lon}&admin_level=${adminLevel}`);
        return response.data?.data || { status: 'error', message: 'No response' };
    },

    getSupportedRegions: async (): Promise<{
        regions: Record<string, {
            name: string;
            osm_relation_id: number;
            states: Record<string, { name: string; osm_relation_id: number }>;
        }>;
    }> => {
        const response = await axios.get<{ data: {
            regions: Record<string, {
                name: string;
                osm_relation_id: number;
                states: Record<string, { name: string; osm_relation_id: number }>;
            }>;
        } }>("/v2/pylovo/boundary/regions");
        return response.data?.data || { regions: {} };
    },

    getAvailableRegions: async (): Promise<{
        status: string;
        regions: Array<{
            country_code: string;
            state_code?: string;
            grid_count: number;
            has_3d?: boolean;
            centroid: { lat: number; lon: number };
            bbox: { west: number; south: number; east: number; north: number };
            region?: {
                name: string;
                admin_level: number;
                country: string;
                country_code: string;
                state_code?: string;
                osm_id: number;
                osm_type: string;
            };
            boundary?: GeoJSON.Feature;
        }>;
    }> => {
        // Return cached data if still fresh
        if (_availableRegionsCache && Date.now() - _availableRegionsCache.timestamp < _REGIONS_CACHE_TTL) {
            return _availableRegionsCache.data;
        }

        // Deduplicate: if a request is already in-flight, reuse its promise
        if (_availableRegionsPromise) {
            return _availableRegionsPromise;
        }

        _availableRegionsPromise = axios.get<{ data: {
            status: string;
            regions: Array<{
                country_code: string;
                state_code?: string;
                grid_count: number;
                has_3d?: boolean;
                centroid: { lat: number; lon: number };
                bbox: { west: number; south: number; east: number; north: number };
                region?: {
                    name: string;
                    admin_level: number;
                    country: string;
                    country_code: string;
                    state_code?: string;
                    osm_id: number;
                    osm_type: string;
                };
                boundary?: GeoJSON.Feature;
            }>;
        } }>("/v2/pylovo/boundary/available", { timeout: 180000 })
            .then(response => {
                const result = response.data?.data || { status: 'error', regions: [] };
                _availableRegionsCache = { data: result, timestamp: Date.now() };
                return result;
            })
            .finally(() => {
                _availableRegionsPromise = null;
            });

        return _availableRegionsPromise;
    },

    // Calculate EV hosting capacity using multi-constraint analysis
    // Based on: "Methods and Tools for PV and EV Hosting Capacity Determination in
    // Low Voltage Distribution Networks—A Review" (Umoh et al., Energies 2023, 16, 3609)
    getHostingCapacity: async (payload: {
        transformer_capacity_kva: number;
        current_peak_load_kw: number;
        charger_power_kw?: number;
        simultaneity_factor?: number;
        // Enhanced parameters for multi-constraint analysis
        nominal_voltage_v?: number;
        voltage_limit_pu?: number;
        cable_impedance_ohm_per_km?: number;
        cable_length_km?: number;
        cable_max_current_a?: number;
    }): Promise<{
        max_chargers: number;
        remaining_capacity_kva: number;
        limiting_factor: string;  // "Transformer Capacity" | "Voltage Drop" | "Cable Thermal"
        status: "safe" | "warning" | "critical";
        charger_power_kw: number;
        simultaneity_factor: number;
        details: {
            transformer_capacity_kva: number;
            current_load_kva: number;
            effective_load_per_charger_kva: number;
            max_chargers_transformer: number;
            transformer_utilization_percent: number;
            voltage_drop_percent: number;
            max_chargers_voltage: number | null;
            cable_loading_percent: number;
            max_chargers_cable: number | null;
            projected_utilization_percent: number;
        };
    }> => {
        const response = await axios.post<{ data: {
            max_chargers: number;
            remaining_capacity_kva: number;
            limiting_factor: string;
            status: "safe" | "warning" | "critical";
            charger_power_kw: number;
            simultaneity_factor: number;
            details: {
                transformer_capacity_kva: number;
                current_load_kva: number;
                effective_load_per_charger_kva: number;
                max_chargers_transformer: number;
                transformer_utilization_percent: number;
                voltage_drop_percent: number;
                max_chargers_voltage: number | null;
                cable_loading_percent: number;
                max_chargers_cable: number | null;
                projected_utilization_percent: number;
            };
        } }>("/v2/pylovo/hosting-capacity", payload);
        return response.data?.data;
    },

    addTransformer: async (payload: {
        coordinates: [number, number];  // [longitude, latitude]
        kva: number;
        grid_result_ids: number[];
        reassign_radius_m?: number;
        user_id?: string;  // User ID - transformer is only visible to this user
        model_id?: number; // Model ID - transformer is scoped to this model (existing models)
        draft_id?: string; // Draft ID for new models before saving
    }): Promise<{
        status: string;
        new_grid_id: number;
        transformer: GeoJSON.FeatureCollection;
        reassigned_buildings: GeoJSON.FeatureCollection;
        lines: GeoJSON.FeatureCollection;
        reassigned_count: number;
        message: string;
    }> => {
        const response = await axios.post<{ data: {
            status: string;
            new_grid_id: number;
            transformer: GeoJSON.FeatureCollection;
            reassigned_buildings: GeoJSON.FeatureCollection;
            lines: GeoJSON.FeatureCollection;
            reassigned_count: number;
            message: string;
        } }>("/v2/pylovo/add-transformer", payload, { timeout: 0 }); // no timeout
        return response.data?.data;
    },

    deleteTransformer: async (
        gridResultId: number,
        userId?: string,
        modelId?: number,
        draftId?: string
    ): Promise<{
        status: string;
        deleted_grid_id: number;
        reassigned_buildings_count: number;
        message: string;
    }> => {
        const response = await axios.post<{ data: {
            status: string;
            deleted_grid_id: number;
            reassigned_buildings_count: number;
            message: string;
        } }>("/v2/pylovo/delete-transformer", {
            grid_result_id: gridResultId,
            user_id: userId,
            model_id: modelId,
            draft_id: draftId
        });
        return response.data?.data;
    },

    moveTransformer: async (
        gridResultId: number,
        coordinates: [number, number],
        userId?: string,
        modelId?: number,
        draftId?: string
    ): Promise<{
        status: string;
        grid_result_id: number;
        buildings_count: number;
        message: string;
    }> => {
        const response = await axios.post<{ data: {
            status: string;
            grid_result_id: number;
            buildings_count: number;
            message: string;
        } }>("/v2/pylovo/move-transformer", { 
            grid_result_id: gridResultId,
            coordinates,
            user_id: userId,
            model_id: modelId,
            draft_id: draftId
        });
        return response.data?.data;
    },

    assignBuilding: async (
        buildingOsmId: string, 
        targetGridId: number,
        userId?: string,
        modelId?: number,
        draftId?: string
    ): Promise<{
        status: string;
        building_osm_id: string;
        old_grid_id: number;
        new_grid_id: number;
        message: string;
    }> => {
        const response = await axios.post<{ data: {
            status: string;
            building_osm_id: string;
            old_grid_id: number;
            new_grid_id: number;
            message: string;
        } }>("/v2/pylovo/assign-building", { 
            building_osm_id: buildingOsmId,
            target_grid_id: targetGridId,
            user_id: userId,
            model_id: modelId,
            draft_id: draftId
        });
        return response.data?.data;
    },

    finalizeTransformers: async (draftId: string, modelId: number, userId?: string): Promise<{
        status: string;
        updated_count: number;
        updated_grid_ids: number[];
        message: string;
    }> => {
        const response = await axios.post<{ 
            status: string;
            updated_count: number;
            updated_grid_ids: number[];
            message: string;
        }>("/v2/pylovo/finalize-transformers", { 
            draft_id: draftId,
            model_id: modelId,
            user_id: userId
        });
        return response.data;
    },

    getCachedRegions: async (): Promise<CachedRegion[]> => {
        const response = await axios.get<{ data: CachedRegion[] }>("/v2/pylovo/regions/cached");
        return response.data?.data || [];
    },

    deleteCachedRegion: async (id: number): Promise<void> => {
        await axios.delete(`/v2/pylovo/regions/cached/${id}`);
    },

    toggleCachedRegion: async (id: number, enabled: boolean): Promise<void> => {
        await axios.patch(`/v2/pylovo/regions/cached/${id}`, { enabled });
    },

    deleteStateData: async (country: string, state: string, dryRun = false): Promise<{
        status: string;
        country_code: string;
        state_code: string;
        tables: Record<string, number>;
    }> => {
        const response = await axios.delete(
            `/v2/pylovo/pipeline/states/${encodeURIComponent(country)}/${encodeURIComponent(state)}?dry_run=${dryRun}&drop_state_row=true`
        );
        return response.data?.data || response.data;
    },
};

export interface CustomBuilding {
    id: number;  // PyLovo API returns "id" not "custom_building_id"
    user_id: string;
    title: string;
    f_class: string;
    building_type: string;
    area: number;
    peak_load_kw: number;
    demand_energy: number;
    geometry: GeoJSON.Point;
    geometry_area: GeoJSON.Polygon;
    is_public: boolean;
    is_owner: boolean;
    icon: string;
    created_at: string;
}

export type { GridStatistics };

export interface CachedRegion {
    id: number;
    region_name: string;
    country: string;
    country_code: string;
    admin_level: number;
    osm_id: number;
    grid_count: number;
    enabled: boolean;
    centroid_lat: number;
    centroid_lon: number;
    created_at: string;
    updated_at: string;
}
