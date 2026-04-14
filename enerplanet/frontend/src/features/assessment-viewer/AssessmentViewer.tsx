import { Fragment, useEffect, useState, useCallback, useRef } from "react";
import { useTranslation } from "@spatialhub/i18n";
import { useParams, useNavigate } from "react-router-dom";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { CopyrightFooter } from "@/components/app-layout/CopyrightFooter";
import { MapContainer } from "@/components/shared/MapContainer";
import axios from "@/lib/axios";
import { Loader2, AlertCircle, Eye, EyeOff } from "lucide-react";
import { useMapStore } from "@/features/interactive-map/store/map-store";
import { useMapProvider } from "@/providers/map-context";
import TileLayer from "ol/layer/Tile";
import TileWMS from "ol/source/TileWMS";
import type Map from "ol/Map";
import { transformExtent, get as getProj } from "ol/proj";
import proj4 from 'proj4';
import { register as registerProj4 } from 'ol/proj/proj4';
import { WorkspaceSelector } from "@/components/workspace/WorkspaceSelector";
import { CreateWorkspaceModal } from "@/components/workspace/CreateWorkspaceModal";
import { type Workspace } from "@/components/workspace/services/workspaceService";
import { useWorkspaceStore } from "@/components/workspace/store/workspace-store";
// Map controls are provided by MapContainer; add search bar overlay locally
import MapSearchBar from "@/features/interactive-map/MapSearchBar";
import {
	Button,
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@spatialhub/ui";

const EPSG_32629 = "EPSG:32629";

interface ModelResult {
	id: number;
	model_id: number;
	geoserver_status: string;
}

interface Model {
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
	workspace?: {
		id: number;
		name: string;
		description?: string;
	};
}

interface LayerInfo {
	wms_url: string;
	layer_name: string;
	status: string;
	bounds?: {
		minx: number;
		miny: number;
		maxx: number;
		maxy: number;
		crs: string;
	};
}

export const AssessmentViewer: React.FC = () => {
	const { t } = useTranslation();
	const { id } = useParams<{ id: string }>();
	const navigate = useNavigate();
	useDocumentTitle('Assessment Result');

	const { map } = useMapStore();
	const { MapControls } = useMapProvider();
	const [model, setModel] = useState<Model | null>(null);
	const [results, setResults] = useState<ModelResult[]>([]);
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [resultLayer, setResultLayer] = useState<TileLayer<TileWMS> | null>(null);
	const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
	const [layerOpacity, setLayerOpacity] = useState(1);
	const [layerVisible, setLayerVisible] = useState(true);
	const previousIdRef = useRef<string | undefined>(undefined);

	const [selectedWorkspace, setSelectedWorkspace] = useState<Workspace | null>(null);
	const [workspaceModels, setWorkspaceModels] = useState<Model[]>([]);
	const [selectedModelId, setSelectedModelId] = useState<number | null>(null);
	const [isLoadingModels, setIsLoadingModels] = useState(false);
	const [isCreateWsOpen, setIsCreateWsOpen] = useState(false);
	const [wsReloadKey, setWsReloadKey] = useState(0);
	const currentWorkspace = useWorkspaceStore(state => state.currentWorkspace);
	const preferredWorkspaceId = useWorkspaceStore(state => state.preferredWorkspaceId);
	const isLoadingPreference = useWorkspaceStore(state => state.isLoading);
	const setCurrentWorkspace = useWorkspaceStore(state => state.setCurrentWorkspace);
	const initializeWorkspace = useWorkspaceStore(state => state.initializeWorkspace);

	const getStatusStyle = (status: string) => {
		if (status === 'completed') return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400';
		if (status === 'running') return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400';
		if (status === 'failed') return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400';
		return 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400';
	};

	useEffect(() => {
		initializeWorkspace();
	}, [initializeWorkspace]);

	useEffect(() => {
		if (model?.workspace) {
			const workspace = model.workspace as Workspace;
			setSelectedWorkspace(workspace);
			loadWorkspaceModels(workspace);
		}
	}, [model]);

	useEffect(() => {
		if (id) {
			setSelectedModelId(Number.parseInt(id, 10));
		}
	}, [id]);

	useEffect(() => {
		if (id && workspaceModels.length > 0) {
			const modelIdNum = Number.parseInt(id, 10);
			const modelExists = workspaceModels.some(m => m.id === modelIdNum);
			if (modelExists && selectedModelId !== modelIdNum) {
				setSelectedModelId(modelIdNum);
			}
		}
	}, [id, workspaceModels, selectedModelId]);

	const loadWorkspaceModels = async (workspace: Workspace) => {
		setIsLoadingModels(true);
		try {
			const models = await getCompletedModelsForWorkspace(workspace.id);
			setWorkspaceModels(models);
		} catch (err) {
			if (import.meta.env.DEV) console.error('Failed to fetch workspace models:', err);
			setWorkspaceModels([]);
		} finally {
			setIsLoadingModels(false);
		}
	};

	const handleWorkspaceChange = useCallback(async (workspace: Workspace | null) => {
		setSelectedWorkspace(workspace);
		setCurrentWorkspace(workspace);

		if (workspace) {
			await loadWorkspaceModels(workspace);
		} else {
			setWorkspaceModels([]);
		}
	}, [setCurrentWorkspace]);

	const handleModelChange = useCallback((modelId: string) => {
		const newModelId = Number.parseInt(modelId, 10);
		if (newModelId && newModelId !== selectedModelId) {
			navigate(`/app/assessment/${newModelId}`);
		}
	}, [navigate, selectedModelId]);

	const addResultLayer = useCallback(async (result: ModelResult) => {
		await addResultLayerToMap(result, map, setError, setResultLayer);
	}, [map]);

	const loadModelAndResults = useCallback(async () => {
		await loadModelAndResultsData(id, map, setModel, setResults, setError, setIsLoading, addResultLayer);
	}, [id, map, addResultLayer]);

	// Reset state when model ID changes
	useEffect(() => {
		if (id && previousIdRef.current !== undefined && previousIdRef.current !== id) {
			// ID changed - remove old layer and reset state
			if (resultLayer && map) {
				map.removeLayer(resultLayer);
			}
			setResultLayer(null);
			setHasLoadedOnce(false);
			setError(null);
			setResults([]);
			setModel(null);
		}
		previousIdRef.current = id;
	}, [id, resultLayer, map]);

	useEffect(() => {
		if (map && id && !hasLoadedOnce) {
			loadModelAndResults();
			setHasLoadedOnce(true);
		}
	}, [map, id, hasLoadedOnce, loadModelAndResults]);

	useEffect(() => {
		return () => {
			if (resultLayer && map) {
				map.removeLayer(resultLayer);
			}
		};
	}, [resultLayer, map]);

	useEffect(() => {
		if (resultLayer) {
			resultLayer.setOpacity(layerOpacity);
		}
	}, [layerOpacity, resultLayer]);

	useEffect(() => {
		if (resultLayer) {
			resultLayer.setVisible(layerVisible);
		}
	}, [layerVisible, resultLayer]);

	const handleOpacityChange = (value: number) => {
		setLayerOpacity(value);
	};

	const toggleLayerVisibility = () => {
		setLayerVisible(!layerVisible);
	};

	const mapOverlays = (
		<>
			{!map && (
				<div className="absolute inset-0 bg-background/80 backdrop-blur-sm z-[2000] flex items-center justify-center">
					<div className="text-center">
						<Loader2 className="w-12 h-12 animate-spin mx-auto text-primary" />
						<p className="mt-4 text-muted-foreground">{t('results.initializingMap')}</p>
					</div>
				</div>
			)}

			{error && (
				<div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 z-[1000] bg-destructive text-destructive-foreground rounded-lg shadow-lg p-4 flex items-center gap-2">
					<AlertCircle className="w-5 h-5" />
					<span>{error}</span>
				</div>
			)}

			{isLoading && map && (
				<div className="absolute bottom-4 right-4 z-[1000] bg-card border border-border rounded-lg shadow-lg p-3 flex items-center gap-2">
					<Loader2 className="w-4 h-4 animate-spin" />
					<span className="text-sm text-foreground">{t('results.loadingResults')}</span>
				</div>
			)}

			{results.length === 0 && !isLoading && !error && model && (
				<div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 z-[1000] bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 text-yellow-800 dark:text-yellow-300 rounded-lg shadow-lg p-4 max-w-md">
					<p className="font-medium">{t('results.noResultsYet')}</p>
					<p className="text-sm mt-1">{t('results.noResultsYetDescription')}</p>
				</div>
			)}

			{/* Risk Level Legend */}
			{results.length > 0 && resultLayer && (
				<div className="absolute bottom-16 left-4 z-10 bg-card/95 backdrop-blur-md border border-border rounded-2xl shadow-xl overflow-hidden transition-all w-[180px]">
					{/* Header */}
					<div className="px-3 py-2.5 bg-gradient-to-r from-orange-500/10 to-red-500/10 border-b border-border">
						<div className="flex items-center gap-2">
							<div className="w-6 h-6 rounded-lg bg-gradient-to-br from-orange-500 to-red-500 flex items-center justify-center">
								<svg className="w-3.5 h-3.5 text-white" fill="currentColor" viewBox="0 0 20 20">
									<path fillRule="evenodd" d="M12.395 2.553a1 1 0 00-1.45-.385c-.345.23-.614.558-.822.88-.214.33-.403.713-.57 1.116-.334.804-.614 1.768-.84 2.734a31.365 31.365 0 00-.613 3.58 2.64 2.64 0 01-.945-1.067c-.328-.68-.398-1.534-.398-2.654A1 1 0 005.05 6.05 6.981 6.981 0 003 11a7 7 0 1011.95-4.95c-.592-.591-.98-.985-1.348-1.467-.363-.476-.724-1.063-1.207-2.03zM12.12 15.12A3 3 0 017 13s.879.5 2.5.5c0-1 .5-4 1.25-4.5.5 1 .786 1.293 1.371 1.879A2.99 2.99 0 0113 13a2.99 2.99 0 01-.879 2.121z" clipRule="evenodd" />
								</svg>
							</div>
							<span className="text-xs font-semibold text-foreground">Fire Risk</span>
						</div>
					</div>
					
					{/* Risk Levels */}
					<div className="p-2.5 space-y-1.5">
						<div className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-muted/50 transition-colors">
							<div className="w-3 h-3 rounded-full bg-[#2563eb] shadow-sm shadow-blue-500/30"></div>
							<span className="text-[11px] font-medium text-foreground flex-1">Very Low</span>
							<span className="text-[10px] text-muted-foreground">1</span>
						</div>
						<div className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-muted/50 transition-colors">
							<div className="w-3 h-3 rounded-full bg-[#16a34a] shadow-sm shadow-green-500/30"></div>
							<span className="text-[11px] font-medium text-foreground flex-1">Low</span>
							<span className="text-[10px] text-muted-foreground">2</span>
						</div>
						<div className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-muted/50 transition-colors">
							<div className="w-3 h-3 rounded-full bg-[#eab308] shadow-sm shadow-yellow-500/30"></div>
							<span className="text-[11px] font-medium text-foreground flex-1">Moderate</span>
							<span className="text-[10px] text-muted-foreground">3</span>
						</div>
						<div className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-muted/50 transition-colors">
							<div className="w-3 h-3 rounded-full bg-[#ea580c] shadow-sm shadow-orange-500/30"></div>
							<span className="text-[11px] font-medium text-foreground flex-1">High</span>
							<span className="text-[10px] text-muted-foreground">4</span>
						</div>
						<div className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-muted/50 transition-colors">
							<div className="w-3 h-3 rounded-full bg-[#dc2626] shadow-sm shadow-red-500/30"></div>
							<span className="text-[11px] font-medium text-foreground flex-1">Very High</span>
							<span className="text-[10px] text-muted-foreground">5</span>
						</div>
					</div>

					{/* Gradient Bar */}
					<div className="px-2.5 pb-2.5">
						<div className="h-1.5 rounded-full bg-gradient-to-r from-[#2563eb] via-[#16a34a] via-[#eab308] via-[#ea580c] to-[#dc2626]"></div>
					</div>
				</div>
			)}

			<MapSearchBar />
			<MapControls />

			<CopyrightFooter position="bottom-left-sidebar" />
		</>
	);

	const mapHeader = (
		<div className="bg-background border-b border-border px-3 py-2 flex items-center justify-between">
			<div className="flex items-center gap-2">
				{isLoadingPreference ? (
					<div className="flex items-center gap-2 px-3 py-1.5 border border-border rounded-lg bg-card text-sm">
						<Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
						<span className="font-medium text-foreground">{t('results.loadingWorkspace')}</span>
					</div>
				) : (
					<>
						<WorkspaceSelector
							onWorkspaceChange={handleWorkspaceChange}
							onCreateWorkspace={() => setIsCreateWsOpen(true)}
							reloadKey={wsReloadKey}
							initialWorkspaceId={model?.workspace?.id ?? preferredWorkspaceId ?? undefined}
							activeWorkspace={selectedWorkspace ?? currentWorkspace}
						/>

						{selectedWorkspace && (
							<Select
								value={selectedModelId?.toString() ?? ''}
								onValueChange={handleModelChange}
								disabled={isLoadingModels || workspaceModels.length === 0}
							>
								<SelectTrigger className="w-[200px] h-9">
									<SelectValue placeholder={
										(() => {
											if (isLoadingModels) return t('results.loadingModels');
											if (workspaceModels.length === 0) return t('results.noCompletedModels');
											return t('results.selectModel');
										})()
									} />
								</SelectTrigger>
								<SelectContent>
									{workspaceModels.map((m) => (
										<SelectItem key={m.id} value={m.id.toString()}>
											{m.title}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						)}
					</>
				)}
			</div>

			{/* Layer Controls */}
			{resultLayer && (
				<div className="flex items-center gap-3">
					{/* Visibility Toggle */}
					<Button
						variant="outline"
						size="sm"
						onClick={toggleLayerVisibility}
						className="h-8 px-3 cursor-pointer"
					>
						{layerVisible ? (
							<>
								<Eye className="w-4 h-4 mr-1.5" />
								<span className="text-xs">{t('results.showLayer')}</span>
							</>
						) : (
							<>
								<EyeOff className="w-4 h-4 mr-1.5" />
								<span className="text-xs">{t('results.layerHidden')}</span>
							</>
						)}
					</Button>

					{/* Opacity Control */}
					<div className="flex items-center gap-2 px-3 py-1.5 border border-border rounded-lg bg-card">
						<label htmlFor="layer-opacity" className="text-xs font-medium text-foreground whitespace-nowrap">{t('results.opacity')}:</label>
						<input
							id="layer-opacity"
							type="range"
							min="0"
							max="1"
							step="0.1"
							value={layerOpacity}
							onChange={(e) => handleOpacityChange(Number.parseFloat(e.target.value))}
							className="w-24 h-1.5 bg-muted rounded-lg appearance-none cursor-pointer"
							aria-label={t('results.opacity')}
							style={{
								background: `linear-gradient(to right, #4f46e5 0%, #4f46e5 ${layerOpacity * 100}%, var(--muted) ${layerOpacity * 100}%, var(--muted) 100%)`
							}}
						/>
						<span className="text-xs font-medium text-muted-foreground w-10 text-right">{Math.round(layerOpacity * 100)}%</span>
					</div>
				</div>
			)}
		</div>
	);

	const sidebar = model ? (
		<div className="relative h-full w-80 border-l border-border bg-background flex flex-col">
			<div className="flex items-center px-3 pt-4">
				<h3 className="text-base font-semibold text-foreground mb-4">{t('results.assessmentDetails')}</h3>
			</div>

			<div className="flex-1 overflow-y-auto pb-4 space-y-3 px-3">
				{/* Model Info Card */}
				<div className="bg-card border border-border rounded-lg p-3 shadow-sm">
					<h4 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
						<svg className="w-4 h-4 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
						</svg>
						{t('results.modelInfo')}
					</h4>
					<div className="space-y-2">
						<div>
							<div className="block text-xs font-medium text-muted-foreground mb-1">{t('common.name')}</div>
							<div className="text-sm font-medium text-foreground">{model.title}</div>
						</div>
						{model.description && (
							<div>
								<div className="block text-xs font-medium text-muted-foreground mb-1">{t('common.description')}</div>
								<div className="text-sm text-muted-foreground break-words">{model.description}</div>
							</div>
						)}
						<div className="pt-2 border-t border-border">
							<div className="flex justify-between items-center">
								<span className="text-xs text-muted-foreground">{t('common.id')}:</span>
								<span className="text-xs font-mono text-foreground">#{model.id}</span>
							</div>
						</div>
					</div>
				</div>

				{/* Location Info Card */}
				<div className="bg-card border border-border rounded-lg p-3 shadow-sm">
					<h4 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
						<svg className="w-4 h-4 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
							<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
						</svg>
						{t('results.location')}
					</h4>
					<div className="space-y-1 text-xs">
						{model.region && (
							<div className="flex justify-between">
								<span className="text-muted-foreground">{t('common.region')}:</span>
								<span className="font-medium text-foreground">{model.region}</span>
							</div>
						)}
						{model.country && (
							<div className="flex justify-between">
								<span className="text-muted-foreground">{t('common.country')}:</span>
								<span className="font-medium text-foreground">{model.country}</span>
							</div>
						)}
					</div>
				</div>

				{/* Time Period Card */}
				<div className="bg-card border border-border rounded-lg p-3 shadow-sm">
					<h4 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
						<svg className="w-4 h-4 text-purple-600 dark:text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
						</svg>
						{t('results.period')}
					</h4>
					<div className="space-y-2">
						<div className="flex justify-between text-xs">
							<span className="text-muted-foreground">{t('common.from')}:</span>
							<span className="font-medium text-foreground">{new Date(model.from_date).toLocaleDateString()}</span>
						</div>
						<div className="flex justify-between text-xs">
							<span className="text-muted-foreground">{t('common.to')}:</span>
							<span className="font-medium text-foreground">{new Date(model.to_date).toLocaleDateString()}</span>
						</div>
						<div className="pt-2 border-t border-border">
							<div className="flex justify-between text-xs">
								<span className="text-muted-foreground">{t('common.duration')}:</span>
								<span className="font-medium text-foreground">
									{Math.ceil((new Date(model.to_date).getTime() - new Date(model.from_date).getTime()) / (1000 * 60 * 60 * 24))} {t('common.days')}
								</span>
							</div>
						</div>
					</div>
				</div>

				{/* Configuration Card */}
				{model.resolution !== undefined && (
					<div className="bg-card border border-border rounded-lg p-3 shadow-sm">
						<h4 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
							<svg className="w-4 h-4 text-orange-600 dark:text-orange-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
								<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
							</svg>
							{t('results.configuration')}
						</h4>
						<div className="space-y-1 text-xs">
							<div className="flex justify-between">
								<span className="text-muted-foreground">{t('results.resolution')}:</span>
								<span className="font-medium text-foreground">{model.resolution} min</span>
							</div>
						</div>
					</div>
				)}

				{/* Status Card */}
				<div className="bg-card border border-border rounded-lg p-3 shadow-sm">
					<h4 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
						<svg className="w-4 h-4 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
						</svg>
						{t('common.status')}
					</h4>
					<div className="space-y-1 text-xs">
						<div className="flex justify-between items-center">
							<span className="text-muted-foreground">{t('common.status')}:</span>
							<span className={`px-2 py-0.5 rounded-full text-xs font-medium ${getStatusStyle(model.status)}`}>
								{model.status.charAt(0).toUpperCase() + model.status.slice(1)}
							</span>
						</div>
						<div className="flex justify-between">
							<span className="text-muted-foreground">{t('common.createdAt')}:</span>
							<span className="font-medium text-foreground">{new Date(model.created_at).toLocaleDateString()}</span>
						</div>
						<div className="flex justify-between">
							<span className="text-muted-foreground">{t('common.updatedAt')}:</span>
							<span className="font-medium text-foreground">{new Date(model.updated_at).toLocaleDateString()}</span>
						</div>
						{model.workspace && (
							<div className="pt-2 border-t border-border">
								<div className="flex justify-between">
									<span className="text-muted-foreground">{t('common.workspace')}:</span>
									<span className="font-medium text-foreground">{model.workspace.name}</span>
								</div>
							</div>
						)}
					</div>
				</div>

				{/* Results Info */}
				{results.length > 0 && (
					<div className="bg-card border border-border rounded-lg p-3 shadow-sm">
						<h4 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
							<svg className="w-4 h-4 text-teal-600 dark:text-teal-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
							</svg>
							{t('common.results')}
						</h4>
						<div className="space-y-1 text-xs">
							<div className="flex justify-between">
								<span className="text-muted-foreground">{t('results.availableResults')}:</span>
								<span className="font-medium text-foreground">{results.length}</span>
							</div>
							<div className="flex justify-between">
								<span className="text-muted-foreground">{t('results.layerStatus')}:</span>
								<span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
									results[0]?.geoserver_status === 'configured' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
									'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
								}`}>
									{results[0]?.geoserver_status || t('common.unknown')}
								</span>
							</div>
						</div>
					</div>
				)}

				{/* Help Card */}
				<div className="mt-4 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
					<div className="flex items-start gap-2">
						<svg className="w-4 h-4 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
						</svg>
						<div className="text-xs text-blue-800 dark:text-blue-300">
							<strong className="font-semibold">{t('results.mapControls')}:</strong> {t('results.mapControlsDescription')}
						</div>
					</div>
				</div>
			</div>
		</div>
	) : null;

	return (
		<Fragment>
			<MapContainer
				modal={false}
				topBar={null}
				sidebar={sidebar}
				showSidebar={!!model}
				mapOverlays={mapOverlays}
				mapHeader={mapHeader}
			/>

			<CreateWorkspaceModal
				isOpen={isCreateWsOpen}
				onClose={() => setIsCreateWsOpen(false)}
				onSuccess={(newWorkspace) => {
					setIsCreateWsOpen(false);
					handleWorkspaceChange(newWorkspace);
					setWsReloadKey((k) => k + 1);
				}}
			/>
		</Fragment>
	);
};

// Helper functions
async function addResultLayerToMap(
	result: ModelResult,
	map: Map | null,
	setError: (error: string) => void,
	setResultLayer: (layer: TileLayer<TileWMS> | null) => void
) {
	if (!map) return;

	if (result.geoserver_status !== 'configured') {
		setError(`Layer not ready yet. Status: ${result.geoserver_status}`);
		return;
	}

	try {
		const layerInfo = await fetchLayerInfo(result.id, setError);
		if (!layerInfo) return;

		const newLayer = createWMSLayer(layerInfo);
		map.addLayer(newLayer);
		setResultLayer(newLayer);

		if (layerInfo.bounds) {
			fitMapToBounds(map, layerInfo.bounds);
		}

		newLayer.getSource()?.on('tileloaderror', () => {
			setError('Failed to load tiles from GeoServer');
		});
	} catch (err: unknown) {
		handleLayerError(err, setError);
	}
}

async function fetchLayerInfo(resultId: number, setError: (error: string) => void): Promise<LayerInfo | null> {
	const response = await axios.get(`/results/${resultId}/layer`);

	if (!response.data?.success || !response.data?.data) {
		setError('Failed to get layer information from backend');
		return null;
	}

	const layerInfo: LayerInfo = response.data.data;

	if (!layerInfo.wms_url || !layerInfo.layer_name) {
		setError('Layer configuration incomplete');
		return null;
	}

	return layerInfo;
}

function createWMSLayer(layerInfo: LayerInfo): TileLayer<TileWMS> {
	const wmsSource = new TileWMS({
		url: layerInfo.wms_url,
		params: {
			'LAYERS': layerInfo.layer_name,
			'TILED': true,
			'FORMAT': 'image/png',
			'TRANSPARENT': true,
		},
		serverType: 'geoserver',
		crossOrigin: 'anonymous',
	});

	return new TileLayer({
		source: wmsSource,
		opacity: 1,
	});
}

function fitMapToBounds(map: Map | null, bounds: LayerInfo['bounds']) {
	if (!map || !bounds) return;

	try {
		const { minx, miny, maxx, maxy, crs } = bounds as { minx: number; miny: number; maxx: number; maxy: number; crs?: string };
		const sourceCrs: string = crs || 'EPSG:4326';

		if (sourceCrs === EPSG_32629) {
			registerProj4(proj4);
			if (!getProj(EPSG_32629)) {
				proj4.defs(EPSG_32629, '+proj=utm +zone=29 +datum=WGS84 +units=m +no_defs +type=crs');
			}
		}

		const extent = transformExtent([minx, miny, maxx, maxy], sourceCrs, 'EPSG:3857');

		map.getView().fit(extent, {
			padding: [50, 50, 50, 50],
			duration: 0,
			maxZoom: 14
		});
	} catch (err) {
		if (import.meta.env.DEV) console.warn('Failed to zoom to layer bounds:', err);
	}
}

function handleLayerError(err: unknown, setError: (error: string) => void) {
	const errorMsg = typeof err === 'object' && err && 'response' in err
		? (err as { response?: { data?: { message?: string } } }).response?.data?.message
		: undefined;
	setError(errorMsg || 'Failed to load layer configuration');
}

async function loadModelAndResultsData(
	id: string | undefined,
	map: Map | null,
	setModel: (model: Model | null) => void,
	setResults: (results: ModelResult[]) => void,
	setError: (error: string) => void,
	setIsLoading: (loading: boolean) => void,
	addResultLayer: (result: ModelResult) => Promise<void>
) {
	if (!id) {
		setError("No model ID provided");
		setIsLoading(false);
		return;
	}

	try {
		setIsLoading(true);
		setError('');

		const [modelRes, resultsRes] = await Promise.all([
			axios.get(`/models/${id}`),
			axios.get(`/models/${id}/results`)
		]);

		if (modelRes.data?.success && modelRes.data?.data) {
			setModel(modelRes.data.data);
		}

		if (resultsRes.data?.success && resultsRes.data?.data) {
			const results = Array.isArray(resultsRes.data.data)
				? resultsRes.data.data
				: [];
			setResults(results);

			if (results.length > 0 && map) {
				await addResultLayer(results[0]);
			}
		}
	} catch (err: unknown) {
		const message = typeof err === 'object' && err && 'response' in err
			? (err as { response?: { data?: { message?: string } } }).response?.data?.message
			: undefined;
		setError(message || "Failed to load assessment results");
	} finally {
		setIsLoading(false);
	}
}

// Helper function to fetch completed models for a workspace
async function getCompletedModelsForWorkspace(workspaceId: number): Promise<Model[]> {
	const response = await axios.get(`/models`, {
		params: { workspace_id: workspaceId }
	});

	if (response.data?.success && response.data?.data) {
		const models: Model[] = Array.isArray(response.data.data)
			? (response.data.data as Model[])
			: [] as Model[];
		return models.filter((m: Model) => m.status === 'completed');
	}

	return [];
}
