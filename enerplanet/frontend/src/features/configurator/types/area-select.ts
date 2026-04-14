export interface AdvancedParameterOption {
	value: string;
	label: string;
}

export interface AdvancedParameter {
	id: string;
	name: string;
	description: string;
	type: 'range' | 'select' | 'boolean' | 'number';
	defaultValue: { min: number; max: number } | string | number | boolean;
	options?: AdvancedParameterOption[];
	min?: number;
	max?: number;
	step?: number;
}

export interface AdvancedParametersState {
	co2_limit: number;
	max_hours: number;
	solver: string;
	autarky: number;
	scenario: string;
	line_type_lv: string;
	line_type_mv: string;
	trafo_mv_lv_type: string;
	pypsa_enabled: boolean;
}

export interface ParameterRangeInputProps {
	parameter: AdvancedParameter;
	value: { min: number; max: number };
	onChange: (value: { min: number; max: number }) => void;
}

export interface ParameterSelectInputProps {
	parameter: AdvancedParameter;
	value: string;
	onChange: (value: string) => void;
}

export interface AdvancedParametersDrawerProps {
	isOpen: boolean;
	onClose: () => void;
	parameters: AdvancedParametersState;
	onParametersChange: (parameters: AdvancedParametersState) => void;
	onReset: () => void;
}

export interface AreaData {
	fromDate: string;
	toDate: string;
	resolution: number;
	modelName: string;
	timestamp: string;
	region?: string;
	coordinates?: [number, number];
}

export interface UseAreaSelectProps {
	onAreaSelected?: (areaData: AreaData) => void;
	onCancel?: () => void;
	editMode?: boolean;
	existingModelId?: number;
	workspaceId?: number;
	polygonCoordinates?: [number, number][][];
	pylovoData?: PylovoGridData;
	advancedParams?: AdvancedParametersState;
	buildingLimit?: number;
	// When true, prevents building/transformer dialogs from opening on click
	suppressDialogOnClick?: boolean;
	// Draft ID for new models (before saving) - used to scope user-placed transformers
	draftId?: string;
}

interface GeoJSONFeature {
	type?: string;
	properties?: Record<string, unknown> | null;
	geometry?: unknown;
}

export interface PylovoGridData {
	buildings?: {
		type: string;
		features: GeoJSONFeature[];
	};
	lines?: {
		type: string;
		features: GeoJSONFeature[];
	};
	mv_lines?: {
		type: string;
		features: GeoJSONFeature[];
	};
	transformers?: {
		type: string;
		features: GeoJSONFeature[];
	};
	grids?: unknown;
	boundary?: {
		region: {
			name: string;
			admin_level: number;
			country?: string;
			country_code?: string;
			osm_id?: number;
		};
		boundary: GeoJSON.Feature;
	};
}

export interface AreaSelectState {
	modelName: string;
	fromDate: string;
	toDate: string;
	resolution: number;
	isSaving: boolean;
	isLoadingModel: boolean;
	showAreaSelectTour: boolean;
	loadedCoordinates?: [number, number][][];
	loadedConfig?: PylovoGridData;
	allPolygons: [number, number][][];
	advancedParams: AdvancedParametersState;
	showAdvancedParams: boolean;
	isDrawing: boolean;
	allowMultiplePolygons: boolean;
	clearTrigger: number;
	cursorPos: { x: number; y: number } | null;
    isGeneratingGrid: boolean;
	// Custom building filters
	includePublicBuildings: boolean;
	includePrivateBuildings: boolean;
	excludedBuildingIds: Set<number>;
}

export interface AreaSelectActions {
	setModelName: (name: string) => void;
	setResolution: (resolution: number) => void;
	handleUpdateRange: (range: { start: any; end: any }) => void;
	setShowAreaSelectTour: (show: boolean) => void;
	handleTourComplete: () => void;
	handleTourSkip: () => void;
	handleSave: () => Promise<void>;
	handleCancel: () => void;
	setAllPolygons: (polygons: [number, number][][]) => void;
	setAdvancedParams: (params: AdvancedParametersState) => void;
	setShowAdvancedParams: (show: boolean) => void;
	handleResetAdvancedParams: () => void;
	handlePolygonDrawn: (coordinates: [number, number][], allPolygons: [number, number][][]) => Promise<void>;
	handlePolygonModified: (allPolygons: [number, number][][]) => Promise<void>;
	handleClearAllPolygons: () => void;
	setAllowMultiplePolygons: (allow: boolean) => void;
	setIsDrawing: (isDrawing: boolean) => void;
	// Custom building filter actions
	setIncludePublicBuildings: (include: boolean) => void;
	setIncludePrivateBuildings: (include: boolean) => void;
	toggleBuildingExclusion: (buildingId: number) => void;
	clearExcludedBuildings: () => void;
}
