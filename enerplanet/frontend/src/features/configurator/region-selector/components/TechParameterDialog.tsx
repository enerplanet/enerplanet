import { useState, useEffect, useRef, useCallback, useMemo, type FC } from "react";
import {
    AlertDialog,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    Button,
    Tooltip,
    TooltipContent,
    TooltipTrigger,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@spatialhub/ui";
import { Info, Loader2, X, Battery, Sun, Wind, Leaf, Flame, Droplets, Home, Building2, Settings2, SolarPanel, Fan, ChevronDown, Search, type LucideIcon } from "lucide-react";
import type { Technology, TechnologyConstraint } from "@/features/technologies/services/technologyService";
import { staticDescriptions, optionDescriptions, inverterTypeEfficiency } from "./parameterDescriptions";
import type { Feature } from "ol";
import type { Geometry } from "ol/geom";
import { useTranslation } from "@spatialhub/i18n";

// Wind turbine data structure
interface WindTurbineData {
    turbine_id: number;
    nominal_power: number;
    hub_height: number[];
    rotor_diameter: number;
}

const iconMap: Record<string, LucideIcon> = {
    battery: Battery,
    sun: Sun,
    wind: Wind,
    leaf: Leaf,
    flame: Flame,
    droplets: Droplets,
    home: Home,
    "building-2": Building2,
    "solar-panel": SolarPanel,
    "wind-turbine": Fan,
};

// Parameter description keys for i18n - these map to translation keys
const parameterDescriptionKeys: Record<string, string> = {
    cont_energy_cap_max: "parameters.cont_energy_cap_max",
    cont_energy_cap_max_systemwide: "parameters.cont_energy_cap_max_systemwide",
    cont_energy_cap_min: "parameters.cont_energy_cap_min",
    cont_energy_cap_scale: "parameters.cont_energy_cap_scale",
    cont_energy_eff: "parameters.cont_energy_eff",
    cont_export_cap: "parameters.cont_export_cap",
    cont_lifetime: "parameters.cont_lifetime",
    cont_storage_cap_max: "parameters.cont_storage_cap_max",
    cont_storage_cap_min: "parameters.cont_storage_cap_min",
    cont_storage_discharge_depth: "parameters.cont_storage_discharge_depth",
    cont_storage_initial: "parameters.cont_storage_initial",
    cont_storage_loss: "parameters.cont_storage_loss",
    cost_energy_cap: "parameters.cost_energy_cap",
    cost_export: "parameters.cost_export",
    cost_interest_rate: "parameters.cost_interest_rate",
    cost_om_annual: "parameters.cost_om_annual",
    cost_om_annual_investment_fraction: "parameters.cost_om_annual_investment_fraction",
    cost_purchase: "parameters.cost_purchase",
    cost_storage_cap: "parameters.cost_storage_cap",
    system_capacity: "parameters.system_capacity",
    azimuth: "parameters.azimuth",
    tilt: "parameters.tilt",
    inv_eff: "parameters.inv_eff",
    losses: "parameters.losses",
    dc_ac_ratio: "parameters.dc_ac_ratio",
    feedstock_per_year: "parameters.feedstock_per_year",
    boiler_efficiency: "parameters.boiler_efficiency",
    total_hhv: "parameters.total_hhv",
    steam_grade_psig: "parameters.steam_grade_psig",
    module_type: "parameters.module_type",
    inverter_type: "parameters.inverter_type",
    optimize_orientation: "parameters.optimize_orientation",
};

// Parameter name/alias keys for i18n
const parameterNameKeys: Record<string, string> = {
    // General capacity parameters
    cont_energy_cap_max: "parameters.names.cont_energy_cap_max",
    cont_energy_cap_max_systemwide: "parameters.names.cont_energy_cap_max_systemwide",
    cont_energy_cap_min: "parameters.names.cont_energy_cap_min",
    cont_energy_cap_scale: "parameters.names.cont_energy_cap_scale",
    cont_energy_eff: "parameters.names.cont_energy_eff",
    cont_export_cap: "parameters.names.cont_export_cap",
    cont_lifetime: "parameters.names.cont_lifetime",
    cont_parasitic_eff: "parameters.names.cont_parasitic_eff",
    cont_resource_eff: "parameters.names.cont_resource_eff",
    // Storage parameters
    cont_storage_cap_max: "parameters.names.cont_storage_cap_max",
    cont_storage_cap_min: "parameters.names.cont_storage_cap_min",
    cont_storage_discharge_depth: "parameters.names.cont_storage_discharge_depth",
    cont_storage_initial: "parameters.names.cont_storage_initial",
    cont_storage_loss: "parameters.names.cont_storage_loss",
    // Cost parameters
    cost_energy_cap: "parameters.names.cost_energy_cap",
    cost_export: "parameters.names.cost_export",
    cost_interest_rate: "parameters.names.cost_interest_rate",
    cost_om_annual: "parameters.names.cost_om_annual",
    cost_om_annual_investment_fraction: "parameters.names.cost_om_annual_investment_fraction",
    cost_om_con: "parameters.names.cost_om_con",
    cost_om_prod: "parameters.names.cost_om_prod",
    cost_purchase: "parameters.names.cost_purchase",
    cost_storage_cap: "parameters.names.cost_storage_cap",
    // PV parameters
    optimize_orientation: "parameters.names.optimize_orientation",
    system_capacity: "parameters.names.system_capacity",
    azimuth: "parameters.names.azimuth",
    tilt: "parameters.names.tilt",
    inv_eff: "parameters.names.inv_eff",
    losses: "parameters.names.losses",
    dc_ac_ratio: "parameters.names.dc_ac_ratio",
    // Biomass parameters
    feedstock_per_year: "parameters.names.feedstock_per_year",
    boiler_efficiency: "parameters.names.boiler_efficiency",
    total_hhv: "parameters.names.total_hhv",
    steam_grade_psig: "parameters.names.steam_grade_psig",
    boiler_numbers: "parameters.names.boiler_numbers",
    flue_gas_temperature: "parameters.names.flue_gas_temperature",
    parasitic_load: "parameters.names.parasitic_load",
    combustor_type: "parameters.names.combustor_type",
    // Geothermal parameters
    well_depth: "parameters.names.well_depth",
    ground_temperature: "parameters.names.ground_temperature",
    thermal_conductivity: "parameters.names.thermal_conductivity",
    // Hydropower parameters
    head: "parameters.names.head",
    flow_rate: "parameters.names.flow_rate",
    turbine_efficiency: "parameters.names.turbine_efficiency",
    module_type: "parameters.names.module_type",
    inverter_type: "parameters.names.inverter_type",
    // Wind parameters
    turbine_id: "parameters.names.turbine_id",
    hub_height: "parameters.names.hub_height",
    rotor_diameter: "parameters.names.rotor_diameter",
    // Consumer parameters
    annual_demand: "parameters.names.annual_demand",
    peak_demand: "parameters.names.peak_demand",
};

const infinityFields = new Set([
    "cont_energy_cap_max_systemwide",
    "cont_export_cap",
    "cont_resource_area_max",
    "cont_resource_cap_max",
]);

interface ConstraintValue {
    key: string;
    value: number | string;
}

// Searchable Select Component for large option lists (e.g., wind turbines)
// Styled to match the WorkspaceSelector dropdown
interface SearchableSelectProps {
    value: string | number;
    options: string[];
    onChange: (value: string) => void;
    placeholder?: string;
    error?: boolean;
    turbineData?: Record<string, WindTurbineData>;
}

const SearchableSelect: FC<SearchableSelectProps> = ({ 
    value, 
    options, 
    onChange, 
    placeholder = "Select...",
    error = false,
    turbineData
}) => {
    const [open, setOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState("");
    
    const filteredOptions = useMemo(() => {
        if (!searchTerm) return options;
        const lower = searchTerm.toLowerCase();
        return options.filter(opt => opt.toLowerCase().includes(lower));
    }, [options, searchTerm]);

    const handleSelect = (option: string) => {
        onChange(option);
        setOpen(false);
        setSearchTerm("");
    };

    // Find turbine info - value can be numeric turbine_id or turbine name
    const { selectedTurbineName, turbineInfo } = useMemo(() => {
        if (!turbineData) return { selectedTurbineName: '', turbineInfo: undefined };
        
        // If value is a number, find the turbine by its numeric id
        if (typeof value === 'number') {
            const entry = Object.entries(turbineData).find(([_, info]) => info.turbine_id === value);
            if (entry) {
                return { selectedTurbineName: entry[0], turbineInfo: entry[1] };
            }
        }
        
        // If value is a string (turbine name), look it up directly
        if (typeof value === 'string' && turbineData[value]) {
            return { selectedTurbineName: value, turbineInfo: turbineData[value] };
        }
        
        return { selectedTurbineName: '', turbineInfo: undefined };
    }, [value, turbineData]);

    return (
        <DropdownMenu open={open} onOpenChange={setOpen}>
            <DropdownMenuTrigger asChild>
                <button
                    type="button"
                    className={`group w-full flex items-center gap-2 px-2.5 py-1.5 bg-card border rounded-lg hover:border-muted-foreground/50 hover:shadow-sm transition-all duration-200 ${error ? 'border-red-500' : 'border-border'}`}
                >
                    <div className="flex items-center justify-center w-6 h-6 bg-muted rounded shrink-0">
                        <Fan className="w-3.5 h-3.5 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0 text-left">
                        {selectedTurbineName && turbineInfo ? (
                            <div className="flex flex-col">
                                <span className="text-sm font-medium text-foreground truncate">{selectedTurbineName}</span>
                                <span className="text-[10px] text-muted-foreground">
                                    {turbineInfo.nominal_power} kW · {turbineInfo.rotor_diameter}m rotor
                                </span>
                            </div>
                        ) : (
                            <span className="text-sm text-muted-foreground">{placeholder}</span>
                        )}
                    </div>
                    <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform duration-200 shrink-0 ${open ? 'rotate-180' : ''}`} />
                </button>
            </DropdownMenuTrigger>

            <DropdownMenuContent 
                className="w-[320px] p-0" 
                align="start"
            >
                {/* Search input */}
                <div className="p-2 border-b border-border shrink-0">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                        <input
                            type="text"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            placeholder="Search wind turbines..."
                            className="w-full pl-9 pr-3 py-2 text-sm bg-muted border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-ring placeholder-muted-foreground text-foreground"
                            autoFocus
                        />
                    </div>
                </div>

                {/* Options list */}
                <div className="max-h-[220px] overflow-y-auto p-1.5">
                    {filteredOptions.length === 0 ? (
                        <div className="px-3 py-4 text-sm text-muted-foreground text-center">
                            {searchTerm ? 'No turbines match your search' : 'No turbines available'}
                        </div>
                    ) : (
                        <div className="space-y-0.5">
                            {filteredOptions.map((option) => {
                                const optTurbineInfo = turbineData ? turbineData[option] : undefined;
                                const isSelected = selectedTurbineName === option;
                                
                                return (
                                    <DropdownMenuItem
                                        key={option}
                                        onSelect={() => handleSelect(option)}
                                        className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-md transition-all duration-150 cursor-pointer ${isSelected ? 'bg-muted' : ''}`}
                                    >
                                        <div className={`flex items-center justify-center w-7 h-7 rounded transition-colors ${isSelected ? 'bg-primary/20' : 'bg-muted'}`}>
                                            <Fan className={`w-3.5 h-3.5 ${isSelected ? 'text-primary' : 'text-muted-foreground'}`} />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-1.5">
                                                <span className={`text-sm truncate ${isSelected ? 'font-semibold text-foreground' : 'font-medium text-foreground'}`}>
                                                    {option}
                                                </span>
                                            </div>
                                            {optTurbineInfo && (
                                                <div className="flex items-center gap-2 mt-0.5">
                                                    <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-300">
                                                        {optTurbineInfo.nominal_power} kW
                                                    </span>
                                                    <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-300">
                                                        ⌀ {optTurbineInfo.rotor_diameter}m
                                                    </span>
                                                </div>
                                            )}
                                        </div>
                                        {isSelected && (
                                            <div className="flex items-center justify-center w-5 h-5 shrink-0">
                                                <svg className="w-4 h-4 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                                </svg>
                                            </div>
                                        )}
                                    </DropdownMenuItem>
                                );
                            })}
                        </div>
                    )}
                </div>

                <div className="px-3 py-2 border-t border-border bg-muted/30 shrink-0">
                    <span className="text-xs text-muted-foreground">
                        {filteredOptions.length} of {options.length} turbines
                    </span>
                </div>
            </DropdownMenuContent>
        </DropdownMenu>
    );
};

// Hub Height Select Component - styled to match SearchableSelect
interface HubHeightSelectProps {
    value: number;
    options: number[];
    onChange: (value: number) => void;
    error?: boolean;
}

const HubHeightSelect: FC<HubHeightSelectProps> = ({ 
    value, 
    options, 
    onChange, 
    error = false 
}) => {
    return (
        <Select
            value={String(value)}
            onValueChange={(val) => onChange(Number(val))}
        >
            <SelectTrigger 
                className={`w-full flex items-center gap-2 px-2.5 py-1.5 bg-card border rounded-lg hover:border-muted-foreground/50 hover:shadow-sm transition-all duration-200 h-auto ${error ? 'border-red-500' : 'border-border'}`}
            >
                <div className="flex items-center justify-center w-6 h-6 bg-muted rounded shrink-0">
                    <svg className="w-3.5 h-3.5 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M8 7l4-4m0 0l4 4m-4-4v18" />
                    </svg>
                </div>
                <div className="flex-1 text-left">
                    <SelectValue placeholder="Select height" />
                </div>
            </SelectTrigger>
            <SelectContent>
                {options.map((height) => (
                    <SelectItem key={height} value={String(height)} className="text-xs">
                        {height} m
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    );
};

interface TechParameterDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    technology: Technology | null;
    building: Feature<Geometry> | null;
    onSave: (techKey: string, constraints: ConstraintValue[], applyToAll?: boolean) => void;
    onClose: () => void;
    showApplyToAll?: boolean;
}

export const TechParameterDialog: FC<TechParameterDialogProps> = ({
    open,
    onOpenChange,
    technology,
    building,
    onSave,
    onClose,
    showApplyToAll = false,
}) => {
    const { t } = useTranslation();
    const [constraintValues, setConstraintValues] = useState<Record<string, number | string>>({});
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [isSaving, setIsSaving] = useState(false);
    const [dynamicOptions, setDynamicOptions] = useState<Record<string, string[]>>({});
    const [windTurbineData, setWindTurbineData] = useState<Record<string, WindTurbineData>>({});
    const [hubHeightOptions, setHubHeightOptions] = useState<number[]>([]);
    const [disabledFields, setDisabledFields] = useState<Set<string>>(new Set());
    const contentRef = useRef<HTMLDivElement>(null);
    const closeButtonRef = useRef<HTMLButtonElement>(null);
    
    // Get translated parameter name/alias
    const getParameterName = useCallback((paramKey: string, fallbackAlias: string): string => {
        if (parameterNameKeys[paramKey]) {
            return t(parameterNameKeys[paramKey], { defaultValue: fallbackAlias });
        }
        return fallbackAlias;
    }, [t]);
    
    // Get description with translation support
    const getDescription = useCallback((paramKey: string, alias: string, customDescription?: string): string => {
        if (customDescription) return customDescription;
        // Use static descriptions for params that have detailed explanations
        if (staticDescriptions[paramKey]) return staticDescriptions[paramKey];
        if (parameterDescriptionKeys[paramKey]) {
            return t(parameterDescriptionKeys[paramKey], { defaultValue: `${alias} - Configure this parameter based on your requirements.` });
        }
        return t('parameters.defaultDescription', { alias, defaultValue: `${alias} - Configure this parameter based on your requirements.` });
    }, [t]);

    // Initialize constraint values
    useEffect(() => {
        if (technology && building) {
            const initialValues: Record<string, number | string> = {};

            technology.constraints.forEach((constraint) => {
                // Check existing tech configuration
                const existingTechs = building.get("techs") || {};
                const existingTech = existingTechs[technology.key];
                const existingConstraint = existingTech?.constraints?.find(
                    (c: ConstraintValue) => c.key === constraint.key
                );

                if (existingConstraint?.value !== undefined) {
                    initialValues[constraint.key] = existingConstraint.value;
                } else if (constraint.osm_based_value) {
                    // Get value from building properties
                    const osmValue = building.get(constraint.osm_based_value);
                    initialValues[constraint.key] = osmValue ?? constraint.default_value;
                } else {
                    initialValues[constraint.key] = constraint.default_value;
                }
            });

            // If inverter_type has a valid value, auto-set inv_eff and disable it
            const invType = initialValues['inverter_type'];
            if (typeof invType === 'number' && inverterTypeEfficiency[invType] !== undefined) {
                initialValues['inv_eff'] = inverterTypeEfficiency[invType];
                setDisabledFields(prev => new Set([...prev, 'inv_eff']));
            }

            // If optimize_orientation is ON (1), disable tilt & azimuth
            const optOrient = initialValues['optimize_orientation'];
            if (optOrient === 1) {
                setDisabledFields(prev => new Set([...prev, 'tilt', 'azimuth']));
            }

            setConstraintValues(initialValues);
            setErrors({});
            setDynamicOptions({}); // Reset dynamic options
        }
    }, [technology, building]);

    // Fetch dynamic options from relationData
    useEffect(() => {
        if (!technology) return;

        const loadDynamicOptions = () => {
            const newOptions: Record<string, string[]> = {};
            
            for (const constraint of technology.constraints) {
                // Check if relationData contains turbine data
                if (constraint.relationData && typeof constraint.relationData === 'object') {
                    const data = constraint.relationData as Record<string, WindTurbineData>;
                    setWindTurbineData(data);
                    newOptions[constraint.key] = Object.keys(data);
                }
            }
            
            if (Object.keys(newOptions).length > 0) {
                setDynamicOptions(prev => ({ ...prev, ...newOptions }));
            }
        };

        loadDynamicOptions();
    }, [technology]);

    // Handle turbine type selection change
    const handleTurbineTypeChange = useCallback((turbineName: string) => {
        if (!windTurbineData[turbineName]) return;
        
        const turbineInfo = windTurbineData[turbineName];
        
        // Update hub height options
        setHubHeightOptions(turbineInfo.hub_height);
        
        // Disable nominal_power and rotor_diameter fields
        setDisabledFields(new Set(['nominal_power', 'rotor_diameter']));
        
        // Update constraint values with turbine data
        // Send the numeric turbine_id instead of the name
        setConstraintValues(prev => ({
            ...prev,
            turbine_id: turbineInfo.turbine_id,
            nominal_power: turbineInfo.nominal_power,
            rotor_diameter: turbineInfo.rotor_diameter,
            hub_height: turbineInfo.hub_height[0] // Default to first hub height
        }));
    }, [windTurbineData]);

    // Initialize turbine data when options are loaded
    useEffect(() => {
        if (Object.keys(dynamicOptions).length > 0 && Object.keys(windTurbineData).length > 0) {
            setConstraintValues(prev => {
                const next = { ...prev };
                let changed = false;
                
                // Handle turbine_id initialization
                const turbineOptions = dynamicOptions['turbine_id'];
                if (turbineOptions && turbineOptions.length > 0) {
                    const currentTurbineValue = next['turbine_id'];
                    
                    // Set first turbine if value is invalid or not set
                    // Check if current value is a valid numeric turbine_id
                    const isValidTurbineId = typeof currentTurbineValue === 'number' && 
                        Object.values(windTurbineData).some(t => t.turbine_id === currentTurbineValue);
                    
                    if (isValidTurbineId) {
                        // Find the turbine info by its numeric id
                        const turbineEntry = Object.entries(windTurbineData).find(
                            ([_, info]) => info.turbine_id === currentTurbineValue
                        );
                        if (turbineEntry) {
                            const turbineInfo = turbineEntry[1];
                            setHubHeightOptions(turbineInfo.hub_height);
                            setDisabledFields(new Set(['nominal_power', 'rotor_diameter']));
                        }
                    } else {
                        const firstTurbine = turbineOptions[0];
                        const turbineInfo = windTurbineData[firstTurbine];
                        if (turbineInfo) {
                            next['turbine_id'] = turbineInfo.turbine_id;
                            next['nominal_power'] = turbineInfo.nominal_power;
                            next['rotor_diameter'] = turbineInfo.rotor_diameter;
                            next['hub_height'] = turbineInfo.hub_height[0];
                            setHubHeightOptions(turbineInfo.hub_height);
                            setDisabledFields(new Set(['nominal_power', 'rotor_diameter']));
                        }
                        changed = true;
                    }
                }
                
                return changed ? next : prev;
            });
        }
    }, [dynamicOptions, windTurbineData]);

    useEffect(() => {
        if (open && technology) {
            requestAnimationFrame(() => closeButtonRef.current?.focus());
        }
    }, [open, technology]);

    const formatValue = (value: number | string) => {
        if (typeof value === "string" && value === "INF") return "∞";
        if (typeof value === "number") {
            return value % 1 === 0 ? value.toString() : value.toFixed(4);
        }
        return value;
    };

    const validateConstraint = (constraint: TechnologyConstraint, value: number | string): string | null => {
        const numValue = typeof value === "string" ? Number.parseFloat(value) : value;

        if (constraint.required && (value === "" || value === null || value === undefined)) {
            return `Required`;
        }

        if (typeof numValue === "number" && !Number.isNaN(numValue)) {
            if (constraint.min !== null && numValue < constraint.min) {
                return `Min: ${constraint.min}`;
            }
            if (constraint.max !== null && constraint.max !== "INF" && numValue > Number(constraint.max)) {
                return `Max: ${constraint.max}`;
            }
        }

        return null;
    };

    const handleValueChange = (key: string, value: string | number) => {
        // Special handling for turbine_id changes
        if (key === 'turbine_id' && typeof value === 'string' && windTurbineData[value]) {
            handleTurbineTypeChange(value);
            return;
        }

        // Special handling for inverter_type changes — auto-set inv_eff
        if (key === 'inverter_type' && typeof value === 'number') {
            const eff = inverterTypeEfficiency[value];
            if (eff !== undefined) {
                setConstraintValues((prev) => ({ ...prev, [key]: value, inv_eff: eff }));
                setDisabledFields((prev) => new Set([...prev, 'inv_eff']));
                return;
            }
        }

        // Special handling for system_capacity — sync cont_energy_cap_max when both exist
        if (key === 'system_capacity' && typeof value === 'number') {
            setConstraintValues((prev) => {
                const next: Record<string, number | string> = { ...prev, [key]: value };
                // If cont_energy_cap_max exists and was previously equal to system_capacity
                // (or less than the new value), update it to match
                if ('cont_energy_cap_max' in prev) {
                    const prevCap = prev['cont_energy_cap_max'];
                    const prevSys = prev['system_capacity'];
                    if (prevCap === prevSys || (typeof prevCap === 'number' && prevCap < value)) {
                        next['cont_energy_cap_max'] = value;
                    }
                }
                return next;
            });
            // Clear errors
            if (errors[key]) {
                setErrors((prev) => {
                    const newErrors = { ...prev };
                    delete newErrors[key];
                    return newErrors;
                });
            }
            return;
        }

        // Special handling for optimize_orientation — disable/enable tilt & azimuth
        if (key === 'optimize_orientation') {
            const isOn = value === 1;
            setDisabledFields((prev) => {
                const next = new Set(prev);
                if (isOn) {
                    next.add('tilt');
                    next.add('azimuth');
                } else {
                    next.delete('tilt');
                    next.delete('azimuth');
                }
                return next;
            });
        }

        setConstraintValues((prev) => ({ ...prev, [key]: value }));

        // Clear error for this field
        if (errors[key]) {
            setErrors((prev) => {
                const newErrors = { ...prev };
                delete newErrors[key];
                return newErrors;
            });
        }
    };

    const handleSave = () => {
        if (!technology) return;

        // Validate all constraints
        const newErrors: Record<string, string> = {};
        technology.constraints.forEach((constraint) => {
            const error = validateConstraint(constraint, constraintValues[constraint.key]);
            if (error) {
                newErrors[constraint.key] = error;
            }
        });

        if (Object.keys(newErrors).length > 0) {
            setErrors(newErrors);
            return;
        }

        setIsSaving(true);

        // Build the constraints array
        const constraints: ConstraintValue[] = technology.constraints.map((constraint) => ({
            key: constraint.key,
            value: constraintValues[constraint.key],
        }));

        onSave(technology.key, constraints, false);
        setIsSaving(false);
        onClose();
    };

    const handleSaveToAll = () => {
        if (!technology) return;

        // Validate all constraints
        const newErrors: Record<string, string> = {};
        technology.constraints.forEach((constraint) => {
            const error = validateConstraint(constraint, constraintValues[constraint.key]);
            if (error) {
                newErrors[constraint.key] = error;
            }
        });

        if (Object.keys(newErrors).length > 0) {
            setErrors(newErrors);
            return;
        }

        setIsSaving(true);

        // Build the constraints array
        const constraints: ConstraintValue[] = technology.constraints.map((constraint) => ({
            key: constraint.key,
            value: constraintValues[constraint.key],
        }));

        onSave(technology.key, constraints, true);
        setIsSaving(false);
        onClose();
    };

    const handleClose = () => {
        onClose();
    };

    if (!technology) return null;

    const IconComponent = iconMap[technology.icon] || Settings2;
    const buildingType = building?.get("type") || "Unknown";
    const buildingOsmId = building?.get("osm_id") || "";

    // Categorize constraints
    const configConstraints = technology.constraints.filter(c => !c.key.startsWith('cost_') && !c.key.startsWith('cont_'));
    const contConstraints = technology.constraints.filter(c => c.key.startsWith('cont_'));
    const costConstraints = technology.constraints.filter(c => c.key.startsWith('cost_'));

    const renderConstraintRow = (constraint: TechnologyConstraint) => {
        const value = constraintValues[constraint.key] ?? constraint.default_value;
        const error = errors[constraint.key];
        const translatedName = getParameterName(constraint.key, constraint.alias);
        const description = getDescription(constraint.key, translatedName, constraint.description);
        const isDisabled = disabledFields.has(constraint.key);
        const isInfinityField = infinityFields.has(constraint.key);

        // Check if it's a dropdown (use dynamic options if available)
        const options = dynamicOptions[constraint.key] || constraint.options;
        const hasOptions = options && options.length > 0;
        
        // Special handling for hub_height - use hubHeightOptions if available
        const isHubHeight = constraint.key === 'hub_height';
        const hubHeightHasOptions = isHubHeight && hubHeightOptions.length > 0;

        // Handle percentage and infinity display
        const isPercentage = constraint.unit?.includes("%");
        let displayValue = isPercentage && typeof value === "number" ? value * 100 : value;

        if (typeof displayValue === "string" && (displayValue === "INF" || displayValue === "inf")) {
            displayValue = "Infinity";
        }

        // Render input control based on type
        const renderControl = () => {
            // Special case: Wind Turbine Searchable Select
            if (constraint.key === 'turbine_id' && hasOptions) {
                return (
                    <SearchableSelect
                        value={value}
                        options={options}
                        onChange={(val) => handleValueChange(constraint.key, val)}
                        turbineData={windTurbineData}
                        error={!!error}
                    />
                );
            }

            // Special case: Hub Height Select
            if (isHubHeight && hubHeightHasOptions) {
                return (
                    <HubHeightSelect
                        value={Number(value)}
                        options={hubHeightOptions}
                        onChange={(val) => handleValueChange(constraint.key, val)}
                        error={!!error}
                    />
                );
            }

            // Standard Dropdown
            if (hasOptions) {
                // Map numeric index to option string (e.g. 0 → first option)
                const numVal = typeof value === 'number' ? value : Number(value);
                const selectValue = (!isNaN(numVal) && Number.isInteger(numVal) && numVal >= 0 && numVal < options.length && !options.includes(String(value)))
                    ? options[numVal]
                    : String(value);
                return (
                    <Select
                        value={selectValue}
                        onValueChange={(val) => {
                            // Store the index if the options map to numeric values
                            const idx = options.indexOf(val);
                            handleValueChange(constraint.key, idx >= 0 ? idx : val);
                        }}
                    >
                        <SelectTrigger
                            className={`w-full h-8 px-2 bg-background border rounded text-xs text-foreground focus:ring-1 focus:ring-ring ${error ? 'border-red-500' : 'border-border'}`}
                        >
                            <SelectValue placeholder="Select..." />
                        </SelectTrigger>
                        <SelectContent>
                            {options?.map((opt) => (
                                <SelectItem key={opt} value={opt} className="text-xs">
                                    {opt}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                );
            }

            // Standard Input
            return (
                <input
                    type={typeof constraint.default_value === "number" ? "number" : "text"}
                    value={displayValue ?? ""}
                    placeholder={isInfinityField ? "Infinity" : ""}
                    disabled={isDisabled}
                    onChange={(e) => {
                        const raw = e.target.value;
                        if (isPercentage) {
                            const parsed = Number.parseFloat(raw);
                            handleValueChange(constraint.key, Number.isNaN(parsed) ? "" : parsed / 100);
                        } else if (typeof constraint.default_value === "number") {
                            handleValueChange(constraint.key, raw === "" ? "" : Number.parseFloat(raw) || 0);
                        } else {
                            handleValueChange(constraint.key, raw);
                        }
                    }}
                    className={`w-full px-2 py-1 bg-background border rounded text-sm text-foreground text-right focus:outline-none focus:ring-1 focus:ring-ring ${error ? 'border-red-500' : 'border-border'} ${isDisabled ? 'opacity-60 cursor-not-allowed bg-muted' : ''}`}
                />
            );
        };

        return (
            <tr key={constraint.key} className="hover:bg-muted/30 transition-colors">
                <td className="px-3 py-2.5">
                    <div className="flex items-center gap-1.5">
                        <div>
                            <p className="text-sm text-foreground">{translatedName}</p>
                            <p className="text-[10px] text-muted-foreground font-mono">{constraint.key}</p>
                        </div>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <button className="p-0.5 rounded hover:bg-muted transition-colors">
                                    <Info className="w-3 h-3 text-muted-foreground" />
                                </button>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="max-w-sm p-2.5 bg-popover border border-border rounded-lg shadow-lg">
                                <div className="space-y-1.5">
                                    <p className="text-xs font-medium text-foreground">{translatedName}</p>
                                    <p className="text-[11px] text-muted-foreground leading-relaxed">{description}</p>
                                    {optionDescriptions[constraint.key] && (
                                        <div className="space-y-1 pt-1 border-t border-border">
                                            {Object.entries(optionDescriptions[constraint.key]).map(([opt, desc]) => (
                                                <p key={opt} className="text-[11px] text-muted-foreground leading-snug">
                                                    <span className="font-medium text-foreground">{opt}</span>{" — "}{desc}
                                                </p>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </TooltipContent>
                        </Tooltip>
                    </div>
                </td>
                <td className="px-3 py-2.5">
                    {renderControl()}
                    {error && <p className="text-[10px] text-red-500 text-right mt-0.5">{error}</p>}
                </td>
                <td className="px-3 py-2.5 text-right">
                    <span className="text-xs text-muted-foreground">{constraint.unit || "—"}</span>
                </td>
                <td className="px-3 py-2.5 text-right">
                    <span className="text-[11px] text-muted-foreground">
                        {(() => {
                            if (constraint.min === null && constraint.max === null) return "—";
                            const minStr = constraint.min === null ? "-∞" : formatValue(constraint.min);
                            const maxStr = constraint.max === null ? "∞" : formatValue(constraint.max);
                            return `${minStr} → ${maxStr}`;
                        })()}
                    </span>
                </td>
            </tr>
        );
    };

    const renderSection = (title: string, constraints: TechnologyConstraint[]) => {
        if (constraints.length === 0) return null;
        return (
            <div className="mb-4">
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 px-1">{title}</h4>
                <div className="border border-border rounded-lg overflow-visible">
                    <table className="w-full">
                        <thead>
                            <tr className="bg-muted/50">
                                <th className="px-3 py-2 text-left text-[11px] font-semibold text-foreground">Parameter</th>
                                <th className="px-3 py-2 text-right text-[11px] font-semibold text-foreground w-32">Value</th>
                                <th className="px-3 py-2 text-right text-[11px] font-semibold text-foreground w-20">Unit</th>
                                <th className="px-3 py-2 text-right text-[11px] font-semibold text-foreground w-24">Range</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                            {constraints.map(renderConstraintRow)}
                        </tbody>
                    </table>
                </div>
            </div>
        );
    };

    return (
        <AlertDialog open={open} onOpenChange={(isOpen) => { if (!isOpen) { onOpenChange(false); handleClose(); } }}>
            <AlertDialogContent
                ref={contentRef}
                className="sm:max-w-2xl p-5"
            >
                <AlertDialogDescription className="sr-only">Configure technology parameters for this building</AlertDialogDescription>
                <Button
                    ref={closeButtonRef}
                    disabled={isSaving}
                    onClick={handleClose}
                    variant="ghost"
                    size="icon"
                    className="absolute z-10 right-3 top-3 size-8 justify-center items-center flex cursor-pointer rounded-lg text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                >
                    <X className="size-4" />
                </Button>

                <AlertDialogHeader className="pr-10">
                    <AlertDialogTitle className="flex items-center gap-2.5 text-xl">
                        <span className="w-9 h-9 bg-gradient-to-br from-gray-700 to-gray-900 dark:from-gray-200 dark:to-gray-400 rounded-xl flex items-center justify-center shadow-lg">
                            <IconComponent className="w-4.5 h-4.5 text-white dark:text-gray-900" />
                        </span>
                        {technology.alias}
                    </AlertDialogTitle>
                    <AlertDialogDescription className="mt-1">
                        {technology.description}
                        <span className="block text-xs mt-1.5 text-muted-foreground/70">
                            Applying to: <span className="font-medium">{showApplyToAll ? "All Buildings" : buildingType}</span> {showApplyToAll ? "" : `(OSM: ${buildingOsmId})`}
                        </span>
                    </AlertDialogDescription>
                </AlertDialogHeader>

                <div className="relative max-h-[55dvh] overflow-visible border-y border-border py-4">
                    <div className="max-h-[50dvh] overflow-auto no-scrollbar pr-2">
                    <div className="flex items-center justify-between mb-3">
                        <h3 className="text-sm font-semibold text-foreground">Parameters</h3>
                        <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-md">
                            {technology.constraints.length} total
                        </span>
                    </div>

                    {renderSection("Configuration", configConstraints)}
                    {renderSection("Constraints", contConstraints)}
                    {renderSection("Costs", costConstraints)}
                    </div>
                </div>

                <AlertDialogFooter className="pt-4 gap-3">
                    <Button
                        type="button"
                        variant="ghost"
                        onClick={handleClose}
                        className="rounded-xl cursor-pointer text-sm h-10 px-5 font-medium text-muted-foreground hover:text-foreground hover:bg-accent"
                    >
                        Cancel
                    </Button>
                    <Button
                        variant="default"
                        onClick={showApplyToAll ? handleSaveToAll : handleSave}
                        disabled={isSaving}
                        className="rounded-xl cursor-pointer text-sm h-10 px-6 font-medium min-w-[calc(var(--spacing)_*_20)] bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
                    >
                        {(() => {
                            if (isSaving) return <Loader2 className="w-4 h-4 animate-spin" />;
                            return showApplyToAll ? "Apply to All Buildings" : "Apply Technology";
                        })()}
                    </Button>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
};
